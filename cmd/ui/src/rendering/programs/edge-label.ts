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

/**
 * Sigma.js Canvas Renderer Edge Label Component
 * =============================================
 *
 * Function used by the canvas renderer to display a single edge's label.
 * @module
 */
import { Attributes } from 'graphology-types';
import { Settings } from 'sigma/settings';
import { Coordinates, NodeDisplayData, PartialButFor } from 'sigma/types';
import { EdgeDistanceProperties, calculateEdgeDistanceForLabel } from 'src/ducks/graph/utils';
import { bezier } from 'src/rendering/utils/bezier';
import { EDGE_LABEL_ALONG_EDGE, getLabelScale } from '../legacyView';
import { GraphItemData, calculateLabelOpacity } from '../utils/utils';
import { getControlPointsFromGroupSize } from './edge.self';
import drawLabel from './node-label';

const PADDING_SCALAR = 5;

const getXPadding = (inverseSqrtZoomRatio: number) => {
    return PADDING_SCALAR * inverseSqrtZoomRatio;
};

export const getBackgroundBoundInfo = (
    inverseSqrtZoomRatio: number,
    textLength: number,
    edgeSize: number,
    edgeLabelSize: number
) => {
    const xPadding = getXPadding(inverseSqrtZoomRatio);
    const deltaX = -textLength / 2 - xPadding;
    const deltaY = (edgeSize / 2) * inverseSqrtZoomRatio - edgeLabelSize * inverseSqrtZoomRatio;
    const width = textLength + 2 * xPadding;
    const height = edgeLabelSize * inverseSqrtZoomRatio * 1.4;

    return { deltaX: deltaX, deltaY: deltaY, width: width, height: height };
};

const getCurvedEdgeStartingPoint = (
    sourceCoords: Coordinates,
    targetCoords: Coordinates,
    control: Coordinates
): Coordinates => {
    return bezier.getCoordinatesAlongQuadraticBezier(sourceCoords, targetCoords, control, 0.5);
};

export const getSelfEdgeStartingPoint = (
    c1: Coordinates,
    c2: Coordinates,
    c3: Coordinates,
    c4: Coordinates
): Coordinates => {
    return bezier.getCoordinatesAlongCubicBezier(c1, c2, c3, c4, 0.5);
};

const getStartingPoint = (
    edgeData: Attributes,
    sourceData: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size'>,
    targetData: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size'>,
    edgeDistance: EdgeDistanceProperties
): Coordinates => {
    if (edgeData.controlInViewport) {
        return getCurvedEdgeStartingPoint(sourceData, targetData, edgeData.controlInViewport);
    } else if (edgeData.type === 'self') {
        const inverseSqrtZoomRatio = edgeData.inverseSqrtZoomRatio || 1;
        const radius = bezier.getLineLength(
            { x: 0, y: 0 },
            {
                x: sourceData.size * Math.pow(inverseSqrtZoomRatio, 2),
                y: sourceData.size * Math.pow(inverseSqrtZoomRatio, 2),
            }
        );

        const { control2, control3 } = getControlPointsFromGroupSize(
            edgeData.groupPosition,
            radius * 3,
            sourceData,
            false,
            true
        );

        return getSelfEdgeStartingPoint(sourceData, control2, control3, sourceData);
    } else {
        return { x: edgeDistance.cx, y: edgeDistance.cy };
    }
};

export default function draw(
    context: CanvasRenderingContext2D,
    edgeData: Attributes,
    sourceData: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size'>,
    targetData: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size'>,
    settings: Settings
): void {
    const label = edgeData.label;

    if (!label) return;

    const edgeDistance = calculateEdgeDistanceForLabel(sourceData, targetData);
    const startingPoint = getStartingPoint(edgeData, sourceData, targetData, edgeDistance);

    if (!EDGE_LABEL_ALONG_EDGE) {
        // Overwrite edge positions with custom-calculated position since non-default edge renderer is used
        const newData = { ...edgeData, ...startingPoint } as GraphItemData;
        drawLabel(context, newData, settings);
        return;
    }

    drawLabelAlongEdge(context, edgeData, sourceData, targetData, startingPoint, settings);
}

/**
 * Legacy view: draw the label rotated to follow the edge, sitting just above the line, with no
 * background box. Curved edges use the tangent at the midpoint (parallel to source -> target for a
 * quadratic curve); self edges stay horizontal. Text is flipped when needed so it never reads upside down.
 */
const drawLabelAlongEdge = (
    context: CanvasRenderingContext2D,
    edgeData: Attributes,
    sourceData: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size'>,
    targetData: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size'>,
    point: Coordinates,
    settings: Settings
): void => {
    const inverseSqrtZoomRatio = edgeData.inverseSqrtZoomRatio || 1;
    // Same sizing as node labels: readable floor, grows on zoom-in, follows the label-size setting
    const labelScale = getLabelScale(inverseSqrtZoomRatio);
    const opacity = calculateLabelOpacity(labelScale);
    if (opacity <= 0) return;

    const size = settings.edgeLabelSize * labelScale;
    context.font = `${settings.edgeLabelWeight} ${size}px ${settings.edgeLabelFont}`;

    const label: string = edgeData.label;
    const isSelf = edgeData.type === 'self';
    const dx = targetData.x - sourceData.x;
    const dy = targetData.y - sourceData.y;
    const length = Math.hypot(dx, dy);

    // Skip labels that would not fit between the two nodes (Legacy does the same).
    // Display sizes here are pre-scaled by sigma, so the on-screen radius is size * inverseSqrtZoomRatio.
    if (
        !isSelf &&
        context.measureText(label).width > length - (sourceData.size + targetData.size) * inverseSqrtZoomRatio
    )
        return;

    let angle = isSelf ? 0 : Math.atan2(dy, dx);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;

    const dimFactor = edgeData.isDimmed ? edgeData.labelDimFactor ?? 0.1 : 1;

    context.save();
    context.translate(point.x, point.y);
    context.rotate(angle);
    context.globalAlpha = opacity * dimFactor;
    context.fillStyle = edgeData.highlighted
        ? edgeData.highlightedBackground ?? edgeData.labelColor
        : edgeData.labelColor ?? settings.edgeLabelColor.color ?? '#000';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillText(label, 0, -((edgeData.size ?? 1) / 2 + 1) * inverseSqrtZoomRatio);
    context.restore();
};
