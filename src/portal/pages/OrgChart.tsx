import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { api, type OrgNode } from '../api';
import OrgTreeNode, { type OrgFlowNode, type OrgFlowNodeData } from '../components/org/OrgTreeNode';
import OrgProfilePanel from '../components/org/OrgProfilePanel';

const POLL_MS = 6000;
const NODE_WIDTH = 256;
const NODE_HEIGHT = 96;

const nodeTypes = { employee: OrgTreeNode };

// dagre only needs to know which rows exist, who reports to whom, and which
// branches are collapsed — a signature of that shape lets us skip re-layout
// on polls that only change presence dots, so the canvas doesn't jitter
// every 6 seconds.
function structuralSignature(users: OrgNode[], collapsed: Set<number>): string {
  return (
    users
      .map((u) => `${u.id}:${u.manager_id ?? ''}:${u.active}`)
      .sort()
      .join('|') +
    '#' +
    [...collapsed].sort((a, b) => a - b).join(',')
  );
}

function layout(
  users: OrgNode[],
  mkData: (u: OrgNode) => OrgFlowNodeData
): { nodes: OrgFlowNode[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 72 });

  const ids = new Set(users.map((u) => u.id));
  users.forEach((u) => g.setNode(String(u.id), { width: NODE_WIDTH, height: NODE_HEIGHT }));
  const edges: Edge[] = [];
  users.forEach((u) => {
    if (u.manager_id != null && ids.has(u.manager_id)) {
      g.setEdge(String(u.manager_id), String(u.id));
      edges.push({
        id: `e${u.manager_id}-${u.id}`,
        source: String(u.manager_id),
        target: String(u.id),
        style: { stroke: '#3f3f46' },
      });
    }
  });

  dagre.layout(g);

  const nodes: OrgFlowNode[] = users.map((u) => {
    const pos = g.node(String(u.id));
    return {
      id: String(u.id),
      type: 'employee',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      // The CEO can't be reassigned and inactive users must be reactivated
      // first — no point letting either be dragged.
      draggable: !u.is_ceo && !!u.active,
      data: mkData(u),
    };
  });

  return { nodes, edges };
}

function descendantIds(rootId: number, users: OrgNode[]): Set<number> {
  const children = new Map<number, number[]>();
  users.forEach((n) => {
    if (n.manager_id != null) {
      const list = children.get(n.manager_id) ?? [];
      list.push(n.id);
      children.set(n.manager_id, list);
    }
  });
  const out = new Set<number>();
  const queue = [rootId];
  while (queue.length) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
}

const passwordPolicyOk = (pw: string) =>
  pw.length >= 10 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

function OrgChartInner() {
  const [users, setUsers] = useState<OrgNode[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<OrgFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createManagerId, setCreateManagerId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', title: '' });
  const [busy, setBusy] = useState(false);
  // A drag-drop reassignment staged for confirmation: nothing is sent to the
  // server until the CEO confirms in the dialog below.
  const [stagedMove, setStagedMove] = useState<{ source: OrgNode; target: OrgNode } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const dragOriginRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const signatureRef = useRef<string>('');
  const pendingLocateRef = useRef<number | null>(null);
  const { setCenter, getIntersectingNodes, fitView } = useReactFlow();

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const selected = selectedId != null ? (usersById.get(selectedId) ?? null) : null;

  const load = useCallback(() => {
    api<{ users: OrgNode[] }>('/org-tree')
      .then((r) => {
        setUsers(r.users);
        setLoading(false);
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Failed to load org tree');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const toggleCollapse = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Derive the rendered graph from users + collapsed branches. Full dagre
  // re-layout (and a viewport refit) only when the structure or collapse
  // state actually changed; presence-only polls just patch node data in
  // place so the canvas never jitters.
  useEffect(() => {
    if (users.length === 0) return;

    const hidden = new Set<number>();
    for (const cid of collapsed) {
      for (const d of descendantIds(cid, users)) hidden.add(d);
    }
    const visible = users.filter((u) => !hidden.has(u.id));

    const mkData = (u: OrgNode): OrgFlowNodeData => ({
      employee: u,
      collapsed: collapsed.has(u.id),
      hiddenCount: collapsed.has(u.id) ? descendantIds(u.id, users).size : 0,
      onToggleCollapse: toggleCollapse,
    });

    const sig = structuralSignature(visible, collapsed);
    if (sig !== signatureRef.current) {
      signatureRef.current = sig;
      const { nodes: n, edges: e } = layout(visible, mkData);
      setNodes(n);
      setEdges(e);
      requestAnimationFrame(() => {
        const locateId = pendingLocateRef.current;
        pendingLocateRef.current = null;
        const target = locateId != null ? n.find((node) => node.id === String(locateId)) : null;
        if (target) {
          setCenter(target.position.x + NODE_WIDTH / 2, target.position.y + NODE_HEIGHT / 2, {
            zoom: 1,
            duration: 400,
          });
        } else {
          void fitView({ padding: 0.15, duration: 300 });
        }
      });
    } else {
      setNodes((prev) => {
        const byId = new Map(visible.map((u) => [String(u.id), u]));
        return prev.map((n) => {
          const employee = byId.get(n.id);
          return employee ? { ...n, data: mkData(employee) } : n;
        });
      });
    }
  }, [users, collapsed, toggleCollapse, setNodes, setEdges, setCenter, fitView]);

  // After any mutation: force a full re-layout on the next fetch.
  const reload = useCallback(() => {
    signatureRef.current = '';
    load();
  }, [load]);

  const restoreDragOrigin = useCallback(() => {
    const origin = dragOriginRef.current;
    if (!origin) return;
    setNodes((prev) => prev.map((n) => (n.id === origin.id ? { ...n, position: { x: origin.x, y: origin.y } } : n)));
    dragOriginRef.current = null;
  }, [setNodes]);

  const onNodeDragStart = useCallback((_evt: unknown, node: Node) => {
    dragOriginRef.current = { id: node.id, x: node.position.x, y: node.position.y };
  }, []);

  const onNodeDragStop = useCallback(
    (_evt: unknown, node: Node) => {
      const source = usersById.get(Number(node.id));
      if (!source) return restoreDragOrigin();

      const hit = getIntersectingNodes(node)[0];
      if (!hit) return restoreDragOrigin();

      const target = usersById.get(Number(hit.id));
      if (!target || target.id === source.id) return restoreDragOrigin();
      if (target.id === source.manager_id) {
        toast.info(`${source.name} already reports to ${target.name}`);
        return restoreDragOrigin();
      }
      if (!target.active) {
        toast.error('Cannot report to a deactivated user');
        return restoreDragOrigin();
      }
      // First line of defense — the server's cycle check is the enforcement.
      if (descendantIds(source.id, users).has(target.id)) {
        toast.error(`${target.name} reports up to ${source.name} — that would create a cycle`);
        return restoreDragOrigin();
      }
      setStagedMove({ source, target });
    },
    [usersById, users, getIntersectingNodes, restoreDragOrigin]
  );

  const confirmMove = async () => {
    if (!stagedMove || busy) return;
    setBusy(true);
    try {
      await api(`/org-tree/users/${stagedMove.source.id}`, {
        method: 'PATCH',
        body: { managerId: stagedMove.target.id },
      });
      toast.success(`${stagedMove.source.name} now reports to ${stagedMove.target.name}`);
      setStagedMove(null);
      dragOriginRef.current = null;
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
      restoreDragOrigin();
      setStagedMove(null);
    } finally {
      setBusy(false);
    }
  };

  const cancelMove = () => {
    restoreDragOrigin();
    setStagedMove(null);
  };

  const openCreate = (managerId: number | null) => {
    setCreateManagerId(managerId);
    setForm({ name: '', email: '', password: '', title: '' });
    setCreating(true);
  };

  const canCreate = form.name.trim() !== '' && form.email.trim() !== '' && passwordPolicyOk(form.password);

  const createUser = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      await api('/users', {
        method: 'POST',
        body: { ...form, managerId: createManagerId ?? undefined },
      });
      toast.success(
        `${form.name} created — temp password: ${form.password}. Share it once; they'll be asked to change it.`
      );
      setCreating(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const locate = (u: OrgNode) => {
    setSearchOpen(false);
    setSelectedId(u.id);
    const node = nodes.find((n) => n.id === String(u.id));
    if (node) {
      setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, { zoom: 1, duration: 500 });
      return;
    }
    // Hidden inside a collapsed branch — expand every collapsed ancestor,
    // then the layout effect centers on them once they exist.
    pendingLocateRef.current = u.id;
    setCollapsed((prev) => {
      const next = new Set(prev);
      let cur = usersById.get(u.id);
      let guard = 0;
      while (cur?.manager_id != null && guard++ < 50) {
        next.delete(cur.manager_id);
        cur = usersById.get(cur.manager_id);
      }
      return next;
    });
  };

  const stagedMoveReportCount = stagedMove ? descendantIds(stagedMove.source.id, users).size : 0;
  const createManager = createManagerId != null ? usersById.get(createManagerId) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[#1f1f23] px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <div>
          <h1 className="font-display font-bold text-xl sm:text-2xl">Org Chart</h1>
          <p className="text-xs sm:text-sm text-[#A1A1AA] mt-0.5">
            {users.length} {users.length === 1 ? 'person' : 'people'} · tap a card to manage · drag onto a new
            manager to move a branch
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Search size={14} className="mr-1.5" /> Find person
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <Command>
                <CommandInput placeholder="Name, email, or title…" />
                <CommandList>
                  <CommandEmpty>No one found.</CommandEmpty>
                  <CommandGroup>
                    {users.map((u) => (
                      <CommandItem key={u.id} value={`${u.name} ${u.email} ${u.title}`} onSelect={() => locate(u)}>
                        {u.name}
                        <span className="ml-2 text-xs text-[#71717A]">{u.title || u.email}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button size="sm" onClick={() => openCreate(null)} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
            <Plus size={14} className="mr-1" /> New employee
          </Button>
        </div>
      </div>

      <div className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#09090B]/60 text-sm text-[#71717A]">
            Loading org chart…
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={(_evt, node) => setSelectedId(Number(node.id))}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          fitView
          colorMode="dark"
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1f1f23" gap={24} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor="#1f1f23"
            maskColor="rgba(9,9,11,0.7)"
            style={{ backgroundColor: '#0c0c0f' }}
            className="hidden sm:block"
          />
        </ReactFlow>
      </div>

      <OrgProfilePanel
        employee={selected}
        allNodes={users}
        onClose={() => setSelectedId(null)}
        onChanged={reload}
        onAddReport={(managerId) => {
          setSelectedId(null);
          openCreate(managerId);
        }}
      />

      {/* Staged drag-reassignment confirmation */}
      <AlertDialog open={!!stagedMove} onOpenChange={(o) => !o && cancelMove()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {stagedMove?.source.name} under {stagedMove?.target.name}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {stagedMove?.source.name} will report to{' '}
                  <strong className="text-[#FAFAFA]">{stagedMove?.target.name}</strong>
                  {stagedMove?.target.title ? ` (${stagedMove.target.title})` : ''}, who becomes their approver for
                  attendance and leave.
                </p>
                {stagedMoveReportCount > 0 && (
                  <p>
                    Their whole branch moves with them —{' '}
                    <strong className="text-[#FAFAFA]">
                      {stagedMoveReportCount} {stagedMoveReportCount === 1 ? 'person' : 'people'}
                    </strong>{' '}
                    below them keep reporting to them.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelMove}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMove} className="bg-[#DFE104] text-black hover:bg-[#c9cb04]">
              Move
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create employee (optionally under a specific manager) */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              New employee{createManager ? ` — reporting to ${createManager.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Full name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-red-500">*</span></Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Role / title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Overall Manager" />
            </div>
            <div className="space-y-1.5">
              <Label>Temporary password <span className="text-red-500">*</span> (shown once)</Label>
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-xs text-[#71717A]">
                10+ characters, with uppercase, lowercase, a number, and a special character.
              </p>
            </div>
            {!createManager && (
              <p className="text-xs text-[#71717A]">
                They'll report to the CEO — drag their card onto a manager afterwards, or open their profile to set one.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={createUser}
              disabled={!canCreate || busy}
              className="bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-50"
            >
              Create employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function OrgChart() {
  return (
    <ReactFlowProvider>
      <OrgChartInner />
    </ReactFlowProvider>
  );
}
