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

import { List, ListItemButton, ListItemText } from '@mui/material';
import { GraphNode } from 'js-client-library';
import React from 'react';
import { useQuery } from 'react-query';
import { ActiveDirectoryPathfindingEdges, AzurePathfindingEdges } from '../../graphSchema';
import { useExploreParams } from '../../hooks/useExploreParams';
import { encodeCypherQuery } from '../../hooks/useExploreGraph/utils';
import { apiClient } from '../../utils/api';
import { EntityInfoDataTableProps } from '../../utils/content';
import EntityInfoCollapsibleSection from './EntityInfoCollapsibleSection';

export const REACHABLE_TIER_ZERO_LABEL = 'Reachable Tier Zero Targets';

const TRAVERSABLE_EDGES = [...new Set<string>([...ActiveDirectoryPathfindingEdges(), ...AzurePathfindingEdges()])];

const cypherString = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Legacy's "Reachable High Value Targets": the shortest path from this object to every Tier Zero object it
 * can reach over traversable edges. Tier Zero is CE's name for Legacy's "high value".
 */
export const reachableTierZeroQuery = (objectId: string) =>
    `MATCH (m) WHERE m.objectid = ${cypherString(objectId)}\n` +
    `MATCH (n:Tag_Tier_Zero) WHERE n <> m\n` +
    `MATCH p=shortestPath((m)-[:${TRAVERSABLE_EDGES.join('|')}*1..]->(n))\n` +
    `RETURN p`;

/** Tier Zero objects in the result other than the start: the targets, and any on the way to them. */
export const getReachableTierZeroTargets = (nodes: Record<string, GraphNode>, objectId: string): GraphNode[] =>
    Object.values(nodes)
        .filter((node) => node.isTierZero && node.objectId !== objectId)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

const fetchTargets = async (objectId: string): Promise<GraphNode[]> => {
    try {
        const response = await apiClient.cypherSearch(reachableTierZeroQuery(objectId));
        return getReachableTierZeroTargets(response.data?.data?.nodes ?? {}, objectId);
    } catch (error: any) {
        // CE answers 404 when nothing matched
        if (error?.response?.status === 404) return [];
        throw error;
    }
};

const ReachableTierZeroSection: React.FC<EntityInfoDataTableProps> = ({ id, label = REACHABLE_TIER_ZERO_LABEL }) => {
    const { setExploreParams, expandedPanelSections } = useExploreParams();
    const isExpanded = ((expandedPanelSections ?? []) as string[]).includes(label);

    const targetsQuery = useQuery(['reachable-tier-zero', id], () => fetchTargets(id), {
        enabled: !!id,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 5 * 60_000,
    });
    const targets = targetsQuery.data ?? [];

    const handleChange = (isOpen: boolean) => {
        if (!isOpen) {
            setExploreParams({ expandedPanelSections: [] });
            return;
        }
        setExploreParams({
            expandedPanelSections: [label],
            searchType: 'cypher',
            exploreSearchTab: 'cypher',
            cypherSearch: encodeCypherQuery(reachableTierZeroQuery(id)),
        });
    };

    return (
        <EntityInfoCollapsibleSection
            label={label}
            count={targetsQuery.isSuccess ? targets.length : undefined}
            isExpanded={isExpanded}
            isLoading={targetsQuery.isLoading}
            isError={targetsQuery.isError}
            error={targetsQuery.error}
            onChange={handleChange}>
            <List dense disablePadding data-testid='reachable-tier-zero-list'>
                {targets.map((target) => (
                    <ListItemButton
                        key={target.objectId}
                        onClick={() =>
                            setExploreParams({
                                primarySearch: target.objectId,
                                searchType: 'node',
                                exploreSearchTab: 'node',
                            })
                        }>
                        <ListItemText primary={target.label} secondary={target.kind} />
                    </ListItemButton>
                ))}
            </List>
        </EntityInfoCollapsibleSection>
    );
};

export default ReachableTierZeroSection;
