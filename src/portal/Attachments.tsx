import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from './api';

interface Attachment {
  id: number;
  filename: string;
  size: number;
  uploaded_by_name: string;
  created_at: string;
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default function Attachments({
  entityType,
  entityId,
  compact = false,
}: {
  entityType: 'task' | 'finance';
  entityId: number;
  compact?: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ attachments: Attachment[] }>(`/attachments?entity_type=${entityType}&entity_id=${entityId}`)
      .then((r) => setItems(r.attachments))
      .catch(() => {});
  }, [entityType, entityId]);
  useEffect(load, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const res = await fetch(
        `/api/attachments?entity_type=${entityType}&entity_id=${entityId}&filename=${encodeURIComponent(file.name)}`,
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream' }, body: file }
      );
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Upload failed');
      load();
      toast.success(`${file.name} attached`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (id: number) => {
    try {
      await api(`/attachments/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <div className="flex items-center gap-2 flex-wrap">
        {items.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1.5 text-xs bg-[#141417] border border-[#1f1f23] px-2 py-1"
          >
            <Paperclip size={11} className="text-[#71717A]" />
            <span className="max-w-40 truncate" title={`${a.filename} · ${fmtSize(a.size)} · ${a.uploaded_by_name}`}>
              {a.filename}
            </span>
            <a href={`/api/attachments/${a.id}/download`} className="text-[#DFE104] hover:opacity-80" title="Download">
              <Download size={11} />
            </a>
            <button onClick={() => remove(a.id)} className="text-[#71717A] hover:text-red-400" title="Delete">
              <Trash2 size={11} />
            </button>
          </span>
        ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="text-[#A1A1AA] hover:text-[#FAFAFA] h-7"
        >
          <Upload size={12} className="mr-1" />
          {uploading ? 'Uploading…' : 'Attach'}
        </Button>
      </div>
    </div>
  );
}
