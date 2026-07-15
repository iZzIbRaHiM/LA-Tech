import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, MonitorX, PhoneOff, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '../AuthContext';
import { api } from '../api';

// WebRTC mesh: every participant holds one peer connection per other
// participant. Media flows browser-to-browser; the server just relays the
// SDP/ICE handshake through polled /meetings/:id/signals. ICE servers come
// from GET /meetings/ice-servers — STUN always, plus a TURN relay when the
// server has TURN_URL/TURN_USERNAME/TURN_CREDENTIAL configured (needed for
// pairs of networks where direct traversal fails).
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const SIGNAL_POLL_MS = 1500;

interface PeerState {
  stream: MediaStream | null;
  name: string;
}

interface MeetingInfo {
  id: number;
  title: string;
  created_by: number;
  ended_at: string | null;
}

export default function MeetingRoom() {
  const { id } = useParams();
  const meetingId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [peers, setPeers] = useState<Map<number, PeerState>>(new Map());
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>(FALLBACK_ICE_SERVERS);
  const cursorRef = useRef(0);
  const leavingRef = useRef(false);

  const myId = user!.id;

  const updatePeer = useCallback((peerId: number, patch: Partial<PeerState>) => {
    setPeers((prev) => {
      const next = new Map(prev);
      const cur = next.get(peerId) ?? { stream: null, name: `#${peerId}` };
      next.set(peerId, { ...cur, ...patch });
      return next;
    });
  }, []);

  const removePeer = useCallback((peerId: number) => {
    pcsRef.current.get(peerId)?.close();
    pcsRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setPeers((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const sendSignal = useCallback(
    (toUser: number, type: 'offer' | 'answer' | 'ice', payload: unknown) => {
      api(`/meetings/${meetingId}/signals`, { method: 'POST', body: { toUser, type, payload } }).catch(() => {});
    },
    [meetingId]
  );

  const ensurePc = useCallback(
    (peerId: number): RTCPeerConnection => {
      let pc = pcsRef.current.get(peerId);
      if (pc) return pc;
      pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcsRef.current.set(peerId, pc);

      localStreamRef.current?.getTracks().forEach((t) => pc!.addTrack(t, localStreamRef.current!));

      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(peerId, 'ice', e.candidate.toJSON());
      };
      pc.ontrack = (e) => {
        updatePeer(peerId, { stream: e.streams[0] ?? new MediaStream([e.track]) });
      };
      pc.onconnectionstatechange = () => {
        if (pc!.connectionState === 'failed') {
          // Mesh peers occasionally fail NAT traversal — drop the tile so it
          // doesn't sit black forever; the roster poll keeps the name visible.
          updatePeer(peerId, { stream: null });
        }
      };
      return pc;
    },
    [sendSignal, updatePeer]
  );

  const makeOffer = useCallback(
    async (peerId: number) => {
      const pc = ensurePc(peerId);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(peerId, 'offer', pc.localDescription);
      } catch {
        /* peer may have vanished */
      }
    },
    [ensurePc, sendSignal]
  );

  const flushPendingIce = useCallback(async (peerId: number, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId) ?? [];
    pendingIceRef.current.delete(peerId);
    for (const c of queued) {
      await pc.addIceCandidate(c).catch(() => {});
    }
  }, []);

  const handleSignal = useCallback(
    async (s: { id: number; from_user: number; type: string; payload: string; from_name: string }) => {
      const peerId = s.from_user;
      const payload = JSON.parse(s.payload || '{}');
      updatePeer(peerId, { name: s.from_name });

      if (s.type === 'peer-left') {
        removePeer(peerId);
        return;
      }

      const pc = ensurePc(peerId);
      if (s.type === 'offer') {
        // Perfect-negotiation-lite: on simultaneous offers, the peer with
        // the higher id is "polite" and rolls back its own offer.
        const polite = myId > peerId;
        const collision = pc.signalingState !== 'stable';
        if (collision && !polite) return; // our offer wins; they'll answer it
        try {
          if (collision) await pc.setLocalDescription({ type: 'rollback' });
          await pc.setRemoteDescription(payload);
          await flushPendingIce(peerId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(peerId, 'answer', pc.localDescription);
        } catch {
          /* stale/duplicate offer */
        }
      } else if (s.type === 'answer') {
        try {
          await pc.setRemoteDescription(payload);
          await flushPendingIce(peerId, pc);
        } catch {
          /* stale answer */
        }
      } else if (s.type === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(payload).catch(() => {});
        else {
          const q = pendingIceRef.current.get(peerId) ?? [];
          q.push(payload);
          pendingIceRef.current.set(peerId, q);
        }
      }
    },
    [ensurePc, flushPendingIce, myId, removePeer, sendSignal, updatePeer]
  );

  const leave = useCallback(
    async (silent = false) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      pcsRef.current.forEach((pc) => pc.close());
      pcsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        await api(`/meetings/${meetingId}/leave`, { method: 'POST' });
      } catch {
        /* best effort */
      }
      if (!silent) navigate('/portal/meetings');
    },
    [meetingId, navigate]
  );

  // Boot: acquire media (gracefully degrading), join, start signal polling.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const info = await api<{ meeting: MeetingInfo }>(`/meetings/${meetingId}`);
        if (cancelled) return;
        setMeeting(info.meeting);
        if (info.meeting.ended_at) return;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Meeting not found');
        navigate('/portal/meetings');
        return;
      }

      // TURN relay config (if the server has one) — fall back to STUN-only.
      try {
        const cfg = await api<{ iceServers: RTCIceServer[] }>('/meetings/ice-servers');
        if (cfg.iceServers?.length) iceServersRef.current = cfg.iceServers;
      } catch {
        /* keep fallback */
      }

      // Camera+mic, falling back to mic-only, falling back to receive-only.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setCamOn(false);
          setMediaError('Camera unavailable — joined with microphone only.');
        } catch {
          setMicOn(false);
          setCamOn(false);
          setMediaError('No camera or microphone — joined as a viewer.');
        }
      }
      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      cameraTrackRef.current = stream?.getVideoTracks()[0] ?? null;
      if (localVideoRef.current && stream) localVideoRef.current.srcObject = stream;

      try {
        const { peers: existing } = await api<{ peers: Array<{ user_id: number; name: string }> }>(
          `/meetings/${meetingId}/join`,
          { method: 'POST' }
        );
        if (cancelled) return;
        setJoined(true);
        for (const p of existing) {
          updatePeer(p.user_id, { name: p.name });
          void makeOffer(p.user_id);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not join');
        navigate('/portal/meetings');
        return;
      }

      interval = setInterval(async () => {
        try {
          const r = await api<{
            signals: Array<{ id: number; from_user: number; type: string; payload: string; from_name: string }>;
            ended: boolean;
            inRoom: Array<{ user_id: number; name: string }>;
          }>(`/meetings/${meetingId}/signals?after=${cursorRef.current}`);
          if (r.ended) {
            toast.info('The meeting was ended');
            await leave();
            return;
          }
          for (const s of r.signals) {
            cursorRef.current = Math.max(cursorRef.current, s.id);
            await handleSignal(s);
          }
          // Keep names fresh from the roster.
          for (const p of r.inRoom) {
            if (p.user_id !== myId && pcsRef.current.has(p.user_id)) updatePeer(p.user_id, { name: p.name });
          }
        } catch {
          /* transient poll failure */
        }
      }, SIGNAL_POLL_MS);
    })();

    const onUnload = () => {
      // keepalive lets the leave call outlive the page.
      fetch(`/api/meetings/${meetingId}/leave`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'X-Requested-With': 'latech-portal' },
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener('beforeunload', onUnload);
      void leave(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const toggleCam = () => {
    const track = cameraTrackRef.current;
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  };

  const replaceVideoEverywhere = async (track: MediaStreamTrack | null) => {
    for (const pc of pcsRef.current.values()) {
      const sender = pc.getSenders().find((sn) => sn.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track).catch(() => {});
    }
  };

  const startShare = async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      await replaceVideoEverywhere(screenTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = display;
      setSharing(true);
      screenTrack.onended = () => void stopShare();
    } catch {
      /* user cancelled the picker */
    }
  };

  const stopShare = async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    await replaceVideoEverywhere(cameraTrackRef.current);
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    setSharing(false);
  };

  const endForAll = async () => {
    try {
      await api(`/meetings/${meetingId}/end`, { method: 'POST' });
      await leave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const peerList = [...peers.entries()];
  const tileCount = peerList.length + 1;
  const gridClass =
    tileCount <= 1
      ? 'grid-cols-1'
      : tileCount <= 4
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-2 lg:grid-cols-3';

  return (
    <div className="flex h-full flex-col bg-[#09090B]">
      <div className="shrink-0 border-b border-[#1f1f23] px-4 py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display font-bold">{meeting?.title ?? 'Meeting'}</div>
          <div className="text-xs text-[#71717A]">
            {joined ? `${tileCount} in room` : 'Connecting…'}
          </div>
        </div>
        {mediaError && (
          <Badge variant="outline" className="hidden sm:inline-flex text-xs text-amber-400 border-amber-900">
            {mediaError}
          </Badge>
        )}
      </div>

      <div className={`flex-1 overflow-auto p-3 grid gap-3 auto-rows-fr ${gridClass}`}>
        {/* Local tile */}
        <div className="relative min-h-40 border border-[#1f1f23] bg-[#0f0f12] overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${sharing ? '' : '-scale-x-100'} ${camOn || sharing ? '' : 'hidden'}`}
          />
          {!camOn && !sharing && (
            <div className="absolute inset-0 flex items-center justify-center text-3xl font-display font-bold text-[#3f3f46]">
              {user?.name?.[0]?.toUpperCase()}
            </div>
          )}
          <span className="absolute bottom-2 left-2 bg-[#09090B]/80 px-2 py-0.5 text-xs">
            You {sharing ? '(sharing screen)' : ''} {!micOn ? '· muted' : ''}
          </span>
        </div>

        {/* Remote tiles */}
        {peerList.map(([peerId, p]) => (
          <RemoteTile key={peerId} peer={p} />
        ))}
      </div>

      {/* Controls */}
      <div className="shrink-0 border-t border-[#1f1f23] px-4 py-3 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={toggleMic} className={micOn ? '' : 'text-red-400 border-red-900'}>
          {micOn ? <Mic size={15} /> : <MicOff size={15} />}
          <span className="ml-1.5 hidden sm:inline">{micOn ? 'Mute' : 'Unmute'}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={toggleCam} className={camOn ? '' : 'text-red-400 border-red-900'}>
          {camOn ? <VideoIcon size={15} /> : <VideoOff size={15} />}
          <span className="ml-1.5 hidden sm:inline">{camOn ? 'Camera off' : 'Camera on'}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={sharing ? stopShare : startShare} className={sharing ? 'text-[#DFE104] border-[#DFE104]/50' : ''}>
          {sharing ? <MonitorX size={15} /> : <MonitorUp size={15} />}
          <span className="ml-1.5 hidden sm:inline">{sharing ? 'Stop sharing' : 'Share screen'}</span>
        </Button>
        <Button size="sm" onClick={() => void leave()} className="bg-red-600 text-white hover:bg-red-700">
          <PhoneOff size={15} />
          <span className="ml-1.5">Leave</span>
        </Button>
        {meeting?.created_by === myId && (
          <Button variant="outline" size="sm" onClick={endForAll} className="text-red-400 border-red-900">
            <Ban size={15} />
            <span className="ml-1.5 hidden sm:inline">End for all</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function RemoteTile({ peer }: { peer: PeerState }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && peer.stream) ref.current.srcObject = peer.stream;
  }, [peer.stream]);
  return (
    <div className="relative min-h-40 border border-[#1f1f23] bg-[#0f0f12] overflow-hidden">
      {peer.stream ? (
        <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[#3f3f46]">
          <span className="text-3xl font-display font-bold">{peer.name[0]?.toUpperCase()}</span>
          <span className="text-xs text-[#71717A]">connecting…</span>
        </div>
      )}
      <span className="absolute bottom-2 left-2 bg-[#09090B]/80 px-2 py-0.5 text-xs">{peer.name}</span>
    </div>
  );
}
