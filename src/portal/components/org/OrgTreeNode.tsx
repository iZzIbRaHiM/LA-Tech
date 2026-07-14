import { ChevronDown, ChevronRight } from 'lucide-react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { OrgNode } from '../../api';

export type OrgFlowNodeData = {
  employee: OrgNode;
  collapsed: boolean;
  hiddenCount: number;
  onToggleCollapse: (id: number) => void;
};

export type OrgFlowNode = Node<OrgFlowNodeData, 'employee'>;

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export default function OrgTreeNode({ data, selected }: NodeProps<OrgFlowNode>) {
  const { employee, collapsed, hiddenCount, onToggleCollapse } = data;
  const inactive = !employee.active;

  return (
    <div
      className={`w-64 border-2 bg-[#0f0f12] px-3 py-2.5 transition-colors ${
        selected ? 'border-[#DFE104]' : 'border-[#1f1f23]'
      } ${inactive ? 'opacity-50' : ''}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#3f3f46]" />
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-[#1c1c20] text-xs">{initials(employee.name)}</AvatarFallback>
          </Avatar>
          {!inactive && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0f0f12] ${
                employee.online ? 'bg-emerald-400' : 'bg-[#3f3f46]'
              }`}
              title={employee.online ? 'Online' : 'Offline'}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-medium">
            {employee.name}
            {employee.is_ceo ? <span className="shrink-0 text-[10px] text-[#DFE104]">CEO</span> : null}
          </div>
          <div className="truncate text-xs text-[#71717A]">{employee.title || 'No title set'}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {employee.department_name && (
          <Badge variant="outline" className="text-[10px]">
            {employee.department_name}
          </Badge>
        )}
        {employee.membership_role === 'intern' && (
          <Badge variant="outline" className="text-[10px] text-[#DFE104] border-[#555]">
            INTERN
          </Badge>
        )}
        {employee.finance_access ? (
          <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-900">
            FINANCE
          </Badge>
        ) : null}
        {employee.direct_reports_count > 0 && (
          <button
            type="button"
            onClick={(ev) => {
              // Chevron must not open the profile panel or start a drag.
              ev.stopPropagation();
              onToggleCollapse(employee.id);
            }}
            onMouseDown={(ev) => ev.stopPropagation()}
            onPointerDown={(ev) => ev.stopPropagation()}
            title={collapsed ? 'Expand branch' : 'Collapse branch'}
            className="nodrag ml-auto flex items-center gap-0.5 text-[10px] text-[#A1A1AA] hover:text-[#DFE104] transition-colors"
          >
            {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            {collapsed && hiddenCount > 0
              ? `+${hiddenCount} hidden`
              : `${employee.direct_reports_count} report${employee.direct_reports_count === 1 ? '' : 's'}`}
          </button>
        )}
        {inactive && (
          <Badge variant="outline" className="text-[10px] text-red-400 border-red-900">
            Deactivated
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#3f3f46]" />
    </div>
  );
}
