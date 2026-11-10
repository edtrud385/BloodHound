// Copyright 2026 Specter Ops, Inc.
//
// Licensed under the Apache License, Version 2.0
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    Button,
    Checkbox,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Popover,
    Select,
    TextField,
    Tooltip,
} from '@mui/material';
import {
    BUILTIN_EDGE_CATEGORIES,
    applyEdgeFilterView,
    deleteEdgeFilterView,
    resetEdgeFilter,
    saveEdgeFilterView,
    setApplyEdgeFilterToQueries,
    setEdgeKindsHidden,
    setHideOrphans,
    useEdgeFilter,
} from 'bh-shared-ui';
import { MultiDirectedGraph } from 'graphology';
import { Attributes } from 'graphology-types';
import { FC, useMemo, useState } from 'react';

type EdgeGroup = { name: string; kinds: { kind: string; count: number }[] };

/** CE's edge category for each edge kind ("Lateral Movement", "Active Directory Certificate Services", ...). */
const GROUP_BY_KIND: Map<string, string> = (() => {
    const byKind = new Map<string, string>();
    BUILTIN_EDGE_CATEGORIES.forEach((category) =>
        category.subcategories.forEach((sub) => {
            const name = category.categoryName === 'Active Directory' ? sub.name : `${sub.name} (Entra ID)`;
            sub.edgeTypes.forEach((kind) => byKind.set(kind, name));
        })
    );
    return byKind;
})();
const GROUP_ORDER = [...new Set(GROUP_BY_KIND.values()), 'Other'];

/** The edge kinds in the graph, with counts, grouped like CE's pathfinding filter. */
const groupGraphEdges = (graph?: MultiDirectedGraph<Attributes, Attributes, Attributes>): EdgeGroup[] => {
    if (!graph) return [];
    const counts = new Map<string, number>();
    graph.forEachEdge((_edge, attrs) => {
        const kind = attrs.label as string | undefined;
        if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    });
    const groups = new Map<string, EdgeGroup>();
    [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([kind, count]) => {
            const name = GROUP_BY_KIND.get(kind) ?? 'Other';
            if (!groups.has(name)) groups.set(name, { name, kinds: [] });
            groups.get(name)!.kinds.push({ kind, count });
        });
    return [...groups.values()].sort((a, b) => GROUP_ORDER.indexOf(a.name) - GROUP_ORDER.indexOf(b.name));
};

type EdgeFilterPanelProps = {
    anchorEl: HTMLElement | null;
    onClose: () => void;
    graph?: MultiDirectedGraph<Attributes, Attributes, Attributes>;
};

/**
 * Legacy-style edge filter. Lists only the edge kinds in the current graph; unticking one hides those
 * edges straight away. "Apply filter to every query" also strips the unticked kinds from queries and
 * re-runs them, and the current ticks can be saved as named views.
 */
const EdgeFilterPanel: FC<EdgeFilterPanelProps> = ({ anchorEl, onClose, graph }) => {
    const filter = useEdgeFilter();
    const hidden = useMemo(() => new Set(filter.hiddenKinds), [filter.hiddenKinds]);
    const groups = useMemo(() => groupGraphEdges(graph), [graph]);
    const inGraph = useMemo(() => new Set(groups.flatMap((g) => g.kinds.map((k) => k.kind))), [groups]);
    const hiddenElsewhere = filter.hiddenKinds.filter((kind) => !inGraph.has(kind));
    const [viewName, setViewName] = useState('');

    return (
        <Popover
            open={!!anchorEl}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { className: 'w-[360px] max-h-[75vh] flex flex-col' } }}
            data-testid='explore_edge-filter-panel'>
            <div className='p-3 pb-2'>
                <div className='flex items-center justify-between'>
                    <h2 className='text-base font-bold'>Edge Filter</h2>
                    <Button size='small' onClick={resetEdgeFilter} disabled={!filter.hiddenKinds.length}>
                        Show all
                    </Button>
                </div>
                <div className='flex items-center gap-1 mt-2'>
                    <FormControl size='small' className='grow'>
                        <InputLabel id='edge-filter-view-label' shrink>
                            View
                        </InputLabel>
                        <Select
                            labelId='edge-filter-view-label'
                            label='View'
                            notched
                            value={filter.viewName ?? ''}
                            onChange={(e) => e.target.value && applyEdgeFilterView(e.target.value)}
                            displayEmpty>
                            <MenuItem value='' disabled>
                                {filter.views.length ? 'Custom' : 'No saved views yet'}
                            </MenuItem>
                            {filter.views.map((view) => (
                                <MenuItem key={view.name} value={view.name}>
                                    {view.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Tooltip title='Delete this view'>
                        <span>
                            <IconButton
                                size='small'
                                aria-label='Delete view'
                                disabled={!filter.viewName}
                                onClick={() => filter.viewName && deleteEdgeFilterView(filter.viewName)}>
                                <FontAwesomeIcon icon={faTrash} size='xs' />
                            </IconButton>
                        </span>
                    </Tooltip>
                </div>
                <form
                    className='flex items-center gap-1 mt-2'
                    onSubmit={(e) => {
                        e.preventDefault();
                        saveEdgeFilterView(viewName);
                        setViewName('');
                    }}>
                    <TextField
                        size='small'
                        className='grow'
                        placeholder='Save current ticks as...'
                        value={viewName}
                        onChange={(e) => setViewName(e.target.value)}
                        inputProps={{ 'aria-label': 'View name' }}
                    />
                    <Button size='small' type='submit' variant='outlined' disabled={!viewName.trim()}>
                        Save
                    </Button>
                </form>
            </div>
            <Divider />
            <div className='overflow-auto px-3 py-1 grow'>
                {groups.length === 0 && <p className='py-3 text-sm'>No edges in the current graph.</p>}
                {groups.map((group) => {
                    const kinds = group.kinds.map((k) => k.kind);
                    const hiddenCount = kinds.filter((kind) => hidden.has(kind)).length;
                    return (
                        <div key={group.name} className='py-1'>
                            <FormControlLabel
                                label={<span className='font-semibold text-sm'>{group.name}</span>}
                                control={
                                    <Checkbox
                                        size='small'
                                        checked={hiddenCount === 0}
                                        indeterminate={hiddenCount > 0 && hiddenCount < kinds.length}
                                        onChange={(e) => setEdgeKindsHidden(kinds, !e.target.checked)}
                                    />
                                }
                            />
                            <div className='pl-6 flex flex-col'>
                                {group.kinds.map(({ kind, count }) => (
                                    <FormControlLabel
                                        key={kind}
                                        className='-my-1'
                                        label={
                                            <span className='text-sm'>
                                                {kind} <span className='opacity-60'>({count})</span>
                                            </span>
                                        }
                                        control={
                                            <Checkbox
                                                size='small'
                                                checked={!hidden.has(kind)}
                                                onChange={(e) => setEdgeKindsHidden([kind], !e.target.checked)}
                                            />
                                        }
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
                {hiddenElsewhere.length > 0 && (
                    <p className='py-2 text-xs opacity-70'>
                        Also hidden (not in this graph): {hiddenElsewhere.join(', ')}
                    </p>
                )}
            </div>
            <Divider />
            <div className='px-3 py-2 flex flex-col'>
                <FormControlLabel
                    label={<span className='text-sm'>Hide nodes left without edges</span>}
                    control={
                        <Checkbox
                            size='small'
                            checked={filter.hideOrphans}
                            onChange={(e) => setHideOrphans(e.target.checked)}
                        />
                    }
                />
                <Tooltip title='Also remove the unticked edge types from every Cypher query and re-run it, so paths around them show up (like Legacy).'>
                    <FormControlLabel
                        label={<span className='text-sm'>Apply filter to every query</span>}
                        control={
                            <Checkbox
                                size='small'
                                checked={filter.applyToQueries}
                                onChange={(e) => setApplyEdgeFilterToQueries(e.target.checked)}
                            />
                        }
                    />
                </Tooltip>
            </div>
        </Popover>
    );
};

export default EdgeFilterPanel;
