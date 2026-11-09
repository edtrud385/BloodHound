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

/*
 * "Legacy view" display behaviour for the Explore graph.
 *
 * Everything in this module is display-only: it changes how an already-fetched
 * graph is laid out and drawn, never what the API returns. It is kept in one
 * file so the fork's diff against upstream CE stays small and easy to rebase.
 *
 *  - Leaf collapse: leaf nodes that hang off the same parent through the same
 *    relationship(s) fold into one group node ("412 User"), like Legacy's node
 *    collapse. Clicking a group node expands it.
 *  - Screen-shaped layout: the left-to-right layout is stretched to the screen's aspect ratio.
 *  - Minimum node size: nodes stop shrinking once zoomed out past a floor.
 *  - Readable labels: a floored font size, single-line labels, and decluttering when zoomed out.
 */

import { MultiDirectedGraph } from 'graphology';
import { Attributes } from 'graphology-types';
import { Extent } from 'sigma/types';

/** A parent needs at least this many matching leaves before they are folded (Legacy's default threshold is 5). */
export const COLLAPSE_THRESHOLD = 5;

/** Camera ratio past which node size is held constant on screen (higher = nodes may shrink further first). */
export const NODE_SIZE_FLOOR_RATIO = 3;

/**
 * Past this camera ratio labels are no longer forced on every node; getDeclutteredLabels picks
 * the ones that fit (group nodes, then most-connected first) so the zoomed-out view stays
 * legible. The selected node always keeps its label.
 */
export const LABEL_DECLUTTER_RATIO = 2;

/** Draw CE's second label line ("Active Directory | User") under each node. Legacy shows the name only. */
export const SHOW_NODE_SUBLABELS = false;

/** Labels never render smaller than this fraction of their full-size font (12px * 0.85 ≈ 10px). */
export const LABEL_MIN_SCALE = 0.85;

export const GROUP_NODE_PREFIX = 'collapsed-group:';
const GROUP_EDGE_PREFIX = 'collapsed-edge:';

export const isGroupNode = (id: string | null | undefined): boolean => !!id && id.startsWith(GROUP_NODE_PREFIX);
export const isGroupEdge = (id: string | null | undefined): boolean => !!id && id.startsWith(GROUP_EDGE_PREFIX);
export const isGroupItem = (id: string | null | undefined): boolean => isGroupNode(id) || isGroupEdge(id);

/** Multiplier applied to node size so nodes keep a minimum on-screen size when zoomed out. */
export const getNodeSizeBoost = (cameraRatio: number): number => Math.max(1, cameraRatio / NODE_SIZE_FLOOR_RATIO);

/** Label scale (font size and opacity) with a readable floor. */
export const getLabelScale = (inverseSqrtZoomRatio: number): number => Math.max(inverseSqrtZoomRatio, LABEL_MIN_SCALE);

type LeafEdge = { key: string; outbound: boolean; label: string };

const pluralize = (kind: string, count: number) => (count === 1 ? kind : `${kind}s`);

/**
 * Fold leaf nodes into group nodes. Leaves are hidden (not removed) so the
 * group can be expanded again without refetching. Tier Zero / owned nodes only
 * fold with nodes carrying the same glyphs, and the group keeps those glyphs.
 */
export const collapseLeaves = (graph: MultiDirectedGraph, threshold = COLLAPSE_THRESHOLD): void => {
    const groups = new Map<string, { parent: string; kind: string; edges: LeafEdge[]; members: string[] }>();

    graph.forEachNode((node, attrs) => {
        if (attrs.hidden || isGroupNode(node)) return;

        const neighbors = graph.neighbors(node);
        if (neighbors.length !== 1) return;

        const parent = neighbors[0];
        // Two leaves pointing at each other would both look like leaves; keep pairs intact.
        if (graph.neighbors(parent).length === 1) return;

        const edges: LeafEdge[] = graph.edges(node).map((key) => ({
            key,
            outbound: graph.source(key) === node,
            label: graph.getEdgeAttribute(key, 'label') ?? '',
        }));
        const signature = edges
            .map((e) => `${e.outbound ? '>' : '<'}${e.label}`)
            .sort()
            .join('|');
        const kind = attrs.kind ?? '';
        // Nodes with glyphs (Tier Zero / owned) only fold with nodes that carry the same glyphs
        const glyphKey = ((attrs.glyphs as { image?: string }[] | undefined) ?? []).map((g) => g.image).join(',');
        const groupKey = `${parent}\u0000${kind}\u0000${glyphKey}\u0000${signature}`;

        const group = groups.get(groupKey);
        if (group) group.members.push(node);
        else groups.set(groupKey, { parent, kind, edges, members: [node] });
    });

    let counter = 0;
    groups.forEach(({ parent, kind, edges, members }) => {
        if (members.length < threshold) return;

        const groupId = `${GROUP_NODE_PREFIX}${counter++}`;
        const sample = graph.getNodeAttributes(members[0]);

        graph.addNode(groupId, {
            ...sample,
            label: `${members.length} ${pluralize(kind || 'Node', members.length)}`,
            size: (sample.size ?? 25) * 1.2,
            hidden: false,
            collapsedMembers: members,
            collapsedParent: parent,
        });

        const seen = new Set<string>();
        edges.forEach(({ key, outbound, label }) => {
            const id = `${outbound ? '>' : '<'}${label}`;
            if (seen.has(id)) return;
            seen.add(id);

            const edgeAttrs = graph.getEdgeAttributes(key);
            const [source, target] = outbound ? [groupId, parent] : [parent, groupId];
            graph.addEdgeWithKey(`${GROUP_EDGE_PREFIX}${groupId}:${id}`, source, target, {
                ...edgeAttrs,
                type: 'arrow',
                groupPosition: 0,
                groupSize: 1,
                exploreGraphId: `${GROUP_EDGE_PREFIX}${groupId}:${id}`,
            });
        });

        members.forEach((member) => graph.setNodeAttribute(member, 'hidden', true));
    });

    syncHiddenPositions(graph);
};

/** Expand a group node back into its members. Returns the ids that were revealed. */
export const expandGroup = (graph: MultiDirectedGraph, groupId: string): string[] => {
    if (!graph.hasNode(groupId)) return [];
    const members: string[] = graph.getNodeAttribute(groupId, 'collapsedMembers') ?? [];
    members.forEach((member) => graph.hasNode(member) && graph.setNodeAttribute(member, 'hidden', false));
    graph.dropNode(groupId);
    return members;
};

/** Expand every group in the graph. */
export const expandAllGroups = (graph: MultiDirectedGraph): void => {
    graph.filterNodes((node) => isGroupNode(node)).forEach((node) => expandGroup(graph, node));
};

/** Find the group node that currently hides `nodeId`, if any. */
export const findGroupContaining = (graph: MultiDirectedGraph, nodeId: string): string | undefined =>
    graph.findNode(
        (node, attrs) => isGroupNode(node) && ((attrs.collapsedMembers as string[] | undefined) ?? []).includes(nodeId)
    );

/** Park hidden members on their group node so they don't distort extents or later layouts. */
export const syncHiddenPositions = (graph: MultiDirectedGraph): void => {
    graph.forEachNode((node, attrs) => {
        if (!isGroupNode(node)) return;
        (attrs.collapsedMembers as string[]).forEach((member) => {
            if (!graph.hasNode(member)) return;
            graph.setNodeAttribute(member, 'x', attrs.x);
            graph.setNodeAttribute(member, 'y', attrs.y);
        });
    });
};

/** Bounding box of the nodes that are actually drawn. */
export const visibleExtent = (
    graph: MultiDirectedGraph<Attributes, Attributes, Attributes>
): { x: Extent; y: Extent } => {
    let xMin = Infinity,
        xMax = -Infinity,
        yMin = Infinity,
        yMax = -Infinity;

    graph.forEachNode((_node, { x, y, hidden }) => {
        if (hidden || typeof x !== 'number' || typeof y !== 'number') return;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
    });

    if (xMin === Infinity) return { x: [0, 1], y: [0, 1] };
    return { x: [xMin, xMax], y: [yMin, yMax] };
};

/**
 * Stretch a left-to-right layout so its bounding box matches the screen's shape, Legacy-style.
 *
 * Dagre packs ranks close together horizontally while a busy rank can be hundreds of nodes
 * tall, so a uniform fit squeezes everything into a thin vertical column. Stretching the
 * short axis keeps dagre's ranks and ordering intact, spreads ranks across the full width
 * (sources on the left, the target on the right) and lets the tallest rank fill the height.
 */
export const stretchToAspect = (graph: MultiDirectedGraph, aspect: number): void => {
    const { x, y } = visibleExtent(graph);
    const width = x[1] - x[0];
    const height = y[1] - y[0];
    if (width <= 0 || height <= 0 || !Number.isFinite(aspect) || aspect <= 0) return;

    const scaleX = width / height < aspect ? (aspect * height) / width : 1;
    const scaleY = width / height > aspect ? width / aspect / height : 1;
    if (scaleX === 1 && scaleY === 1) return;

    graph.forEachNode((node, attrs) => {
        if (attrs.hidden) return;
        graph.setNodeAttribute(node, 'x', x[0] + (attrs.x - x[0]) * scaleX);
        graph.setNodeAttribute(node, 'y', y[0] + (attrs.y - y[0]) * scaleY);
    });
};

/** Screen-space cell (px) that may hold one label when zoomed out. */
const DECLUTTER_CELL_WIDTH = 170;
const DECLUTTER_CELL_HEIGHT = 36;

const declutterCache = new WeakMap<object, { key: string; labels: Set<string> }>();

/** Bump after any layout so cached label choices are recomputed. */
export const markLayoutChanged = (graph: MultiDirectedGraph): void => {
    graph.setAttribute('layoutVersion', (graph.getAttribute('layoutVersion') ?? 0) + 1);
};

/**
 * Pick which nodes get a label at the given zoom: at most one per screen cell, preferring
 * group nodes and then the most connected nodes (the chokepoints you want to read first).
 * Cached per zoom step and layout, so the node reducer can call it for every node.
 */
export const getDeclutteredLabels = (
    graph: MultiDirectedGraph<Attributes, Attributes, Attributes>,
    cameraRatio: number
): Set<string> => {
    const step = Math.round(Math.log(cameraRatio) * 8);
    const key = `${step}:${graph.order}:${graph.getAttribute('layoutVersion') ?? 0}`;
    const cached = declutterCache.get(graph);
    if (cached && cached.key === key) return cached.labels;

    const ratio = Math.exp(step / 8);
    // At ratio 1 one graph unit is about one pixel (see resetCamera's custom bbox)
    const cellWidth = DECLUTTER_CELL_WIDTH * ratio;
    const cellHeight = DECLUTTER_CELL_HEIGHT * ratio;

    const candidates = graph
        .filterNodes((_node, attrs) => !attrs.hidden && !!attrs.label)
        .map((node) => ({ node, priority: (isGroupNode(node) ? 1e9 : 0) + graph.degree(node) }))
        .sort((a, b) => b.priority - a.priority);

    const taken = new Set<string>();
    const labels = new Set<string>();
    candidates.forEach(({ node }) => {
        const { x, y } = graph.getNodeAttributes(node);
        const cell = `${Math.floor(x / cellWidth)}:${Math.floor(y / cellHeight)}`;
        if (taken.has(cell)) return;
        taken.add(cell);
        labels.add(node);
    });

    declutterCache.set(graph, { key, labels });
    return labels;
};
