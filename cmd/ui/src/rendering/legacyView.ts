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
 *  - Leaf collapse: when a node has at least COLLAPSE_THRESHOLD leaf neighbours, the leaves
 *    are hidden and the node shows a count bubble, like Legacy's node collapse.
 *    Double-clicking the node expands them again.
 *  - Screen-shaped layout: the left-to-right layout is stretched to the screen's aspect ratio.
 *  - Node and label sizes: a readable floor at the fitted (zoomed-out) view, growing as you
 *    zoom in like Legacy, with a user label-size multiplier.
 *  - Readable labels: single-line, no background boxes, decluttered only where they would pile up.
 */

import { MultiDirectedGraph } from 'graphology';
import { Attributes } from 'graphology-types';
import Sigma from 'sigma';
import { Extent } from 'sigma/types';

/** A parent needs at least this many matching leaves before they are folded (Legacy's default threshold is 5). */
export const COLLAPSE_THRESHOLD = 5;

/**
 * Node size floor: at the fitted (fully zoomed-out) view nodes are drawn as if the camera ratio were
 * this value, so they never shrink to dots. From there they grow smoothly as you zoom in and reach
 * CE's normal size at 1:1 zoom.
 */
export const NODE_SIZE_FLOOR_RATIO = 3;

/** Floored labels grow from LABEL_MIN_SCALE at the fitted view to this scale at 1:1 zoom (12px * 1.25 = 15px). */
const LABEL_SCALE_AT_ONE = 1.25;

/**
 * Past this camera ratio labels are no longer forced on every node; getDeclutteredLabels picks
 * the ones that fit (collapsed parents, then most-connected first) so the zoomed-out view stays
 * legible. The selected node always keeps its label.
 */
export const LABEL_DECLUTTER_RATIO = 2;

/** Draw CE's second label line ("Active Directory | User") under each node. Legacy shows the name only. */
export const SHOW_NODE_SUBLABELS = false;

/** Draw CE's white box behind node labels. Legacy draws the text straight on the canvas. */
export const NODE_LABEL_BACKGROUND = false;

/** Draw edge labels rotated along the edge with no background box, like Legacy, instead of CE's boxed labels. */
export const EDGE_LABEL_ALONG_EDGE = true;

/** Icons are drawn at this fraction of CE's size so names stand out, like Legacy (labels keep their size). */
export const NODE_ICON_SCALE = 0.75;

/** Font weight of node labels (CE uses bold; Legacy-style labels are regular weight). */
export const NODE_LABEL_WEIGHT = 'normal';

/** Legacy-style tapered edges: width at the source end and at the target end, relative to CE's width. */
export const EDGE_TAPER_START = 1.6;
export const EDGE_TAPER_END = 0.45;

/** On-screen gap between the labels of parallel edges, in label heights. */
export const PARALLEL_LABEL_SPACING = 1.3;

/**
 * Factor for CE's curve heights so that parallel edges between the same two nodes bow at least one label
 * line apart on screen at the current zoom, letting each label sit on its own curve. CE's offsets
 * (multiples of `groupSpread` in framed-graph units) shrink to nothing on Legacy's wide layouts.
 */
export const parallelCurveScale = (sigma: Sigma, labelPx: number, groupSpread: number): number => {
    const a = sigma.viewportToFramedGraph({ x: 0, y: 0 });
    const b = sigma.viewportToFramedGraph({ x: 0, y: 100 });
    const framedPerPx = Math.hypot(b.x - a.x, b.y - a.y) / 100;
    // Neighbouring curves' midpoints are groupSpread / 2 apart (a quadratic bows half its control offset)
    return Math.max(1, (2 * labelPx * PARALLEL_LABEL_SPACING * framedPerPx) / groupSpread);
};

/** Width CE gives every edge (views/Explore/utils.ts); the shaders scale tapered edges from it. */
export const EDGE_BASE_SIZE = 4;

/** Thinnest on-screen width (px) of a tapered edge's narrow end; the whole edge scales up to keep it. */
export const EDGE_MIN_END_PX = 0.9;

/**
 * GLSL replacing sigma's per-vertex `max(normalLength, 1.7 * u_sqrtZoomRatio)` floor. Applied to each
 * end separately, that floor flattens a tapered edge to a uniform 1.7 px once zoomed out. Scaling the
 * whole edge by one factor until its narrow end reaches the floor keeps the taper at every zoom.
 */
export const TAPERED_THICKNESS_GLSL = `max(1.0, ${EDGE_MIN_END_PX.toFixed(2)} * u_sqrtZoomRatio / ${(
    EDGE_BASE_SIZE * EDGE_TAPER_END
).toFixed(4)}) * normalLength`;

/** Edge width multiplier at `t` along the edge (0 = source, 1 = target). */
export const edgeTaper = (t: number): number => EDGE_TAPER_START + (EDGE_TAPER_END - EDGE_TAPER_START) * t;

/** Labels never render smaller than this fraction of their full-size font (12px * 0.85 ≈ 10px). */
export const LABEL_MIN_SCALE = 0.85;

/** Range and step for the user's label-size multiplier (node and edge labels). */
export const LABEL_SIZE_MIN = 0.6;
export const LABEL_SIZE_MAX = 2.5;
export const LABEL_SIZE_STEP = 1.15;
const LABEL_SIZE_STORAGE_KEY = 'bh-legacy-view-label-size';

const readStoredLabelSize = (): number => {
    try {
        const stored = Number(window.localStorage.getItem(LABEL_SIZE_STORAGE_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : 1;
    } catch {
        return 1;
    }
};

let labelSizeMultiplier = typeof window !== 'undefined' ? readStoredLabelSize() : 1;

/** Current label-size multiplier (1 = default). */
export const getLabelSizeMultiplier = (): number => labelSizeMultiplier;

/** Set the label-size multiplier (clamped) and remember it in this browser. Returns the applied value. */
export const setLabelSizeMultiplier = (value: number): number => {
    labelSizeMultiplier = Math.min(LABEL_SIZE_MAX, Math.max(LABEL_SIZE_MIN, value));
    try {
        window.localStorage.setItem(LABEL_SIZE_STORAGE_KEY, String(labelSizeMultiplier));
    } catch {
        // storage unavailable (private window): the setting just won't persist
    }
    return labelSizeMultiplier;
};

/** Camera ratio of the last "fit whole graph" view; sizes are floored relative to it. */
let fitRatio = 1;
export const setFitRatio = (ratio: number): void => {
    if (Number.isFinite(ratio) && ratio > 0) fitRatio = ratio;
};

/**
 * Smooth growth curve for a size floor: `floor` at the fitted ratio, `atOne` at ratio 1, following a
 * power law in between (and beyond, so it keeps growing), never below `floor` when zoomed out further.
 */
const flooredScale = (cameraRatio: number, floor: number, atOne: number): number => {
    if (fitRatio <= 1 || atOne <= floor) return floor;
    const exponent = Math.log(atOne / floor) / Math.log(fitRatio);
    return Math.max(floor, floor * Math.pow(fitRatio / cameraRatio, exponent));
};

/**
 * Multiplier applied to node size. CE draws nodes at size / ratio, so they shrink to dots when
 * zoomed out. Here nodes keep the NODE_SIZE_FLOOR_RATIO size at the fitted view and grow smoothly as
 * you zoom in (Legacy-like), meeting CE's natural size at 1:1 zoom.
 */
export const getNodeSizeBoost = (cameraRatio: number): number => {
    // On-screen size relative to CE's size at ratio 1
    const floorFactor =
        fitRatio > NODE_SIZE_FLOOR_RATIO
            ? flooredScale(cameraRatio, 1 / NODE_SIZE_FLOOR_RATIO, 1)
            : 1 / NODE_SIZE_FLOOR_RATIO;
    return Math.max(1, cameraRatio * floorFactor);
};

/**
 * Label scale (font size; opacity uses it too). LABEL_MIN_SCALE at the fitted view, growing smoothly
 * as you zoom in (Legacy-like), never smaller than CE's own size, times the user's label-size setting.
 */
export const getLabelScale = (inverseSqrtZoomRatio: number): number => {
    const cameraRatio = 1 / (inverseSqrtZoomRatio * inverseSqrtZoomRatio);
    const floor = flooredScale(cameraRatio, LABEL_MIN_SCALE, LABEL_SCALE_AT_ONE);
    return Math.max(inverseSqrtZoomRatio, floor) * labelSizeMultiplier;
};

/** Number of leaves currently folded into `node` (0 when none). */
export const getCollapsedCount = (attrs: Attributes): number =>
    (attrs.collapsedMembers as string[] | undefined)?.length ?? 0;

/**
 * What a count bubble stands for, e.g. "694 Computers folded in (HasSession)", for the hover tooltip.
 * Empty when the node has nothing folded into it.
 */
export const describeCollapsed = (graph: MultiDirectedGraph, node: string): string => {
    if (!graph.hasNode(node)) return '';
    const members: string[] = graph.getNodeAttribute(node, 'collapsedMembers') ?? [];
    if (!members.length) return '';
    const kinds = new Map<string, number>();
    const edges = new Set<string>();
    members.forEach((member) => {
        if (!graph.hasNode(member)) return;
        const kind = (graph.getNodeAttribute(member, 'kind') as string) || 'node';
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        graph.edges(member, node).forEach((e) => edges.add(graph.getEdgeAttribute(e, 'label')));
        graph.edges(node, member).forEach((e) => edges.add(graph.getEdgeAttribute(e, 'label')));
    });
    const what = [...kinds.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`)
        .join(', ');
    const via = [...edges].filter(Boolean).sort().join(', ');
    return `${what} folded in${via ? ` (${via})` : ''}, each connected only to this node. Double-click, or right-click > Expand, to show them.`;
};

/**
 * Legacy-style node collapse: when a node has at least `threshold` leaf neighbours (nodes whose only
 * neighbour is that node), hide the leaves and record them on the node, which then shows a count
 * bubble. Leaves are hidden, not removed, so they can be expanded again without refetching.
 */
export const collapseLeaves = (graph: MultiDirectedGraph, threshold = COLLAPSE_THRESHOLD): void => {
    const leavesByParent = new Map<string, string[]>();

    graph.forEachNode((node, attrs) => {
        if (attrs.hidden) return;

        const neighbors = graph.neighbors(node);
        if (neighbors.length !== 1) return;

        const parent = neighbors[0];
        // Two nodes connected only to each other would both look like leaves; keep pairs intact.
        if (graph.neighbors(parent).length === 1) return;

        const leaves = leavesByParent.get(parent);
        if (leaves) leaves.push(node);
        else leavesByParent.set(parent, [node]);
    });

    leavesByParent.forEach((leaves, parent) => {
        if (leaves.length < threshold) return;
        leaves.forEach((leaf) => graph.setNodeAttribute(leaf, 'hidden', true));
        graph.setNodeAttribute(parent, 'collapsedMembers', leaves);
    });

    syncHiddenPositions(graph);
};

/** Expand the leaves folded into `node` (they can be folded back with `recollapse`). Returns the ids revealed. */
export const expandCollapsed = (graph: MultiDirectedGraph, node: string): string[] => {
    if (!graph.hasNode(node)) return [];
    const members: string[] = graph.getNodeAttribute(node, 'collapsedMembers') ?? [];
    members.forEach((member) => graph.hasNode(member) && graph.setNodeAttribute(member, 'hidden', false));
    graph.removeNodeAttribute(node, 'collapsedMembers');
    // Remember them so they can be folded back from the right-click menu
    if (members.length) graph.setNodeAttribute(node, 'expandedMembers', members);
    return members;
};

/** Number of leaves that were expanded in place from `node` and can be folded back (0 when none). */
export const getExpandedCount = (attrs: Attributes): number =>
    (attrs.expandedMembers as string[] | undefined)?.length ?? 0;

/** The part of the graph currently on screen, in graph coordinates. */
export type ViewBounds = { xMin: number; xMax: number; yMin: number; yMax: number };

/** Fold expanded leaves (see `expandCollapsed`) back into their parent's count bubble. */
export const recollapse = (graph: MultiDirectedGraph, node: string): void => {
    if (!graph.hasNode(node)) return;
    const members = ((graph.getNodeAttribute(node, 'expandedMembers') as string[] | undefined) ?? []).filter((member) =>
        graph.hasNode(member)
    );
    graph.removeNodeAttribute(node, 'expandedMembers');
    if (!members.length) return;
    members.forEach((member) => graph.setNodeAttribute(member, 'hidden', true));
    graph.setNodeAttribute(node, 'collapsedMembers', members);
    syncHiddenPositions(graph);
    markLayoutChanged(graph);
};

/** Find the node whose count bubble currently hides `nodeId`, if any. */
export const findCollapsedParent = (graph: MultiDirectedGraph, nodeId: string): string | undefined =>
    graph.findNode((_node, attrs) => ((attrs.collapsedMembers as string[] | undefined) ?? []).includes(nodeId));

/** Park folded leaves on their parent so they don't distort extents or later layouts. */
export const syncHiddenPositions = (graph: MultiDirectedGraph): void => {
    graph.forEachNode((_node, attrs) => {
        if (!getCollapsedCount(attrs)) return;
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

/**
 * Screen-space cell (px) that may hold one label when zoomed out. Small on purpose: labels are
 * only dropped where they would pile almost exactly on top of each other, so nearly every name
 * stays on screen (Legacy shows all of them, overlapping).
 */
const DECLUTTER_CELL_WIDTH = 100;
const DECLUTTER_CELL_HEIGHT = 5;

const declutterCache = new WeakMap<object, { key: string; labels: Set<string> }>();

/** Bump after any layout so cached label choices are recomputed. */
export const markLayoutChanged = (graph: MultiDirectedGraph): void => {
    graph.setAttribute('layoutVersion', (graph.getAttribute('layoutVersion') ?? 0) + 1);
};

/**
 * Pick which nodes get a label at the given zoom: at most one per screen cell, preferring
 * collapsed parents and then the most connected nodes (the chokepoints you want to read first).
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
        .map((node) => ({
            node,
            priority: (getCollapsedCount(graph.getNodeAttributes(node)) ? 1e9 : 0) + graph.degree(node),
        }))
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

const formatCount = (count: number): string => (count >= 10000 ? `${Math.round(count / 1000)}k` : String(count));

/**
 * Draw Legacy's count bubble (black circle, white number, bottom-left of the node) on every visible
 * node that has collapsed leaves. Runs after each sigma render, on the labels canvas, so it shows
 * even when that node's label is hidden or labels are switched off.
 */
export const drawCollapsedBadges = (sigma: Sigma): void => {
    const canvas = sigma.getCanvases().labels;
    const context = canvas?.getContext('2d');
    if (!context) return;

    const graph = sigma.getGraph();
    const ratio = sigma.getCamera().ratio;
    const font = sigma.getSetting('labelFont') ?? 'Roboto';

    graph.forEachNode((node, attrs) => {
        const count = getCollapsedCount(attrs);
        if (!count) return;

        const display = sigma.getNodeDisplayData(node) as (Attributes & { x: number; y: number }) | undefined;
        if (!display || display.hidden) return;

        const { x, y } = sigma.framedGraphToViewport(display);
        // On-screen node radius: node programs draw at size / camera ratio
        const nodeRadius = (display.size ?? 0) / ratio;
        const text = formatCount(count);
        const fontSize = Math.max(9, nodeRadius * 0.55);

        context.save();
        context.font = `bold ${fontSize}px ${font}`;
        const badgeRadius = Math.max(fontSize * 0.8, context.measureText(text).width / 2 + 3);
        const cx = x - nodeRadius * 0.75;
        const cy = y + nodeRadius * 0.75;

        context.globalAlpha = display.isDimmed ? display.dimFactor ?? 0.3 : 1;
        context.beginPath();
        context.arc(cx, cy, badgeRadius, 0, Math.PI * 2);
        context.fillStyle = '#000000';
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = '#ffffff';
        context.stroke();

        context.fillStyle = '#ffffff';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, cx, cy + 0.5);
        context.restore();
    });
};
