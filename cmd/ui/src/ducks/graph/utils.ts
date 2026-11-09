// Copyright 2023 Specter Ops, Inc.
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

import AbstractGraph, { Attributes } from 'graphology-types';
import Sigma from 'sigma';
import { Coordinates, Extent, NodeDisplayData } from 'sigma/types';
import { visibleExtent } from 'src/rendering/legacyView';

export const GROUP_SPREAD = 0.06;
export const MIN_CAMERA_RATIO = 0.5;
// Raised from upstream's 15 so graphs with thousands of nodes can still be fitted on one screen.
export const MAX_CAMERA_RATIO = 500;

/** Node drags shorter than this distance are considered accidental and handled as clicks */
export const DRAG_THRESHOLD = 8;

/**
 * Value of primary mouse button click events
 * @see https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button#value
 */
export const MOUSE_BUTTON_PRIMARY = 0;

/**
 * Return distance between two coordinates
 *
 * @param start start coordinate
 * @param end end coordinate
 * @returns distance between the two corrdinates
 */
export const getDistanceBetween = (start: Coordinates, end: Coordinates) => {
    const a = end.x - start.x;
    const b = end.y - start.y;
    return Math.sqrt(a * a + b * b);
};

/**
 * Return coordinates representing the offset between a node's location and a position.
 *
 * @param node A node on a graph
 * @param position A position on a graph
 * @returns x and y offset from node to position
 */
export const getNodeOffset = (node: Attributes, position: Coordinates): Coordinates => ({
    x: position.x - node.x,
    y: position.y - node.y,
});

export const getEdgeDataFromKey = (edgeKey: string): null | { source: string; target: string; label: string } => {
    const keyChunks = edgeKey.split('_');
    const source = keyChunks.shift();
    const target = keyChunks.pop();
    const label = keyChunks.join('_');

    if (!source) {
        console.warn('Invalid edge key. No source found');
        return null;
    }
    if (!target) {
        console.warn('Invalid edge key. No target found');
        return null;
    }
    if (!label) {
        console.warn('Invalid edge key. Unable to evaluate label');
        return null;
    }

    return { source: source, target: target, label: label };
};

export const getEdgeSourceAndTargetDisplayData = (
    source: string,
    target: string,
    sigma: Sigma
): { source: NodeDisplayData; target: NodeDisplayData } | null => {
    const sourceDisplayData = sigma.getNodeDisplayData(source);
    const targetDisplayData = sigma.getNodeDisplayData(target);

    if (!sourceDisplayData || !targetDisplayData) return null;
    return { source: sourceDisplayData, target: targetDisplayData };
};

export type LinkedNode = {
    size: number;
    x: number;
    y: number;
};

export type EdgeDistanceProperties = { distance: number; cx: number; cy: number };
//This is for a single linear edge
export const calculateEdgeDistanceForLabel = (source: LinkedNode, target: LinkedNode): EdgeDistanceProperties => {
    // Computing positions without considering nodes sizes:
    const sSize = source.size;
    const tSize = target.size;
    let sx = source.x;
    let sy = source.y;
    let tx = target.x;
    let ty = target.y;
    let cx = (sx + tx) / 2;
    let cy = (sy + ty) / 2;
    let dx = tx - sx;
    let dy = ty - sy;
    let d = Math.sqrt(dx * dx + dy * dy);

    //Don't render label since nodes sizes engulf edge
    if (d < sSize + tSize) return { distance: 0, cx: cx, cy: cy };

    // Adding nodes sizes:
    sx += (dx * sSize) / d;
    sy += (dy * sSize) / d;
    tx -= (dx * tSize) / d;
    ty -= (dy * tSize) / d;
    cx = (sx + tx) / 2;
    cy = (sy + ty) / 2;
    dx = tx - sx;
    dy = ty - sy;
    d = Math.sqrt(dx * dx + dy * dy);
    return { distance: d, cx: cx, cy: cy };
};

export const getEdgeLabelTextLength = (
    context: CanvasRenderingContext2D,
    edgeLabel: string,
    edgeDistance: number
): number => {
    let label = edgeLabel;
    let textLength = context.measureText(label).width;

    if (textLength > edgeDistance && edgeDistance !== 0) {
        const ellipsis = '…';
        label = label + ellipsis;
        textLength = context.measureText(label).width;

        while (textLength > edgeDistance && label.length > 1) {
            label = label.slice(0, -2) + ellipsis;
            textLength = context.measureText(label).width;
        }

        if (label.length < 4) return 0;
    }
    return textLength;
};

export const graphToFramedGraph = (
    sigma: Sigma<AbstractGraph<Attributes, Attributes, Attributes>>,
    coordinates: Coordinates
): Coordinates => {
    return sigma.viewportToFramedGraph(sigma.graphToViewport(coordinates));
};

const graphGetMidpoint = (graphExtent: { x: Extent; y: Extent }): Coordinates => {
    const { x: xExtent, y: yExtent } = graphExtent;
    const [xMin, xMax] = xExtent;
    const [yMin, yMax] = yExtent;
    const midX = (xMax + xMin) / 2;
    const midY = (yMax + yMin) / 2;

    return { x: midX, y: midY };
};

/** Screen-space margin (px) kept around the fitted graph so edge-most labels are not clipped. */
const FIT_PADDING_PX = 80;

/**
 * Fit the whole (visible) graph on screen, Legacy-style. Unlike upstream, this always
 * fits rather than only zooming out on overflow, and it never magnifies past 1:1.
 */
const centerCameraOnGraph = (sigma: Sigma<AbstractGraph<Attributes, Attributes, Attributes>>): void => {
    const extent = visibleExtent(sigma.getGraph() as any);
    const camera = sigma.getCamera();
    const { width, height } = sigma.getDimensions();

    const graphWidth = extent.x[1] - extent.x[0];
    const graphHeight = extent.y[1] - extent.y[0];
    const usableWidth = Math.max(width - 2 * FIT_PADDING_PX, 1);
    const usableHeight = Math.max(height - 2 * FIT_PADDING_PX, 1);

    // The custom bbox maps one graph unit to one pixel at ratio 1, so the fit ratio is a plain size ratio.
    let ratio = Math.max(graphWidth / usableWidth, graphHeight / usableHeight, 1);
    if (ratio < MIN_CAMERA_RATIO) ratio = MIN_CAMERA_RATIO;
    if (ratio > MAX_CAMERA_RATIO) ratio = MAX_CAMERA_RATIO;

    camera.animate(
        { ...camera.getState(), x: 0.5, y: 0.5, ratio },
        {
            easing: 'quadraticOut',
            duration: 250,
        },
        () => {
            sigma.scheduleRefresh();
        }
    );
};

const calculateNewBBox = (sigma: Sigma): { x: Extent; y: Extent } => {
    const originalExtent = visibleExtent(sigma.getGraph() as any);
    const midpoint = graphGetMidpoint(originalExtent);
    const { width, height } = sigma.getDimensions();

    return {
        x: [midpoint.x - width / 2, midpoint.x + width / 2],
        y: [midpoint.y - height / 2, midpoint.y + height / 2],
    };
};

export const resetCamera = (sigma: Sigma<AbstractGraph<Attributes, Attributes, Attributes>>): void => {
    sigma.setCustomBBox(calculateNewBBox(sigma));
    setTimeout(() => {
        centerCameraOnGraph(sigma);
    }, 250);
};
