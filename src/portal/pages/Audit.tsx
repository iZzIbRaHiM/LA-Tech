import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '../api';

interface AuditRow {
  id: number;
  actor_name: string;
  entity_type: string;
  entity_id: number;
  action: string;
  metadata: string;
  created_at: string;
}

export default function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    const q = filter !== 'all' ? `&entity_type=${filter}` : '';
    api<{ audit: AuditRow[]; types: Array<{ entity_type: string }> }>(`/audit?limit=${LIMIT}&offset=${offset}${q}`)
      .then((r) => {
        setRows(r.audit);
        setTypes(r.types.map((t) => t.entity_type));
      })
      .catch((e) => toast.error(e.message));
  }, [filter, offset]);

  const prettyMeta = (m: string) => {
    try {
      const obj = JSON.parse(m);
      const entries = Object.entries(obj);
      if (!entries.length) return '';
      return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
    } catch {
      return m;
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="ptitle font-display font-bold text-2xl mb-1">Audit Log</h1>
          <p className="text-sm text-[#A1A1AA]">Every org, task, project, finance, and attendance mutation.</p>
        </div>
        <Select
          value={filter}
          onValueChange={(v) => {
            setFilter(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs text-[#A1A1AA] whitespace-nowrap">{r.created_at}</TableCell>
              <TableCell>{r.actor_name}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs capitalize">
                  {r.entity_type}
                </Badge>
              </TableCell>
              <TableCell className="capitalize">{r.action.replace(/_/g, ' ')}</TableCell>
              <TableCell className="text-xs text-[#71717A] max-w-64 truncate" title={prettyMeta(r.metadata)}>
                {prettyMeta(r.metadata)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && <p className="text-sm text-[#71717A] mt-4">No entries.</p>}

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          ← Newer
        </Button>
        <Button variant="outline" size="sm" disabled={rows.length < LIMIT} onClick={() => setOffset(offset + LIMIT)}>
          Older →
        </Button>
      </div>
    </div>
  );
}
