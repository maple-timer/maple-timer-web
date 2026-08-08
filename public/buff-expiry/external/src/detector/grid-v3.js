import { clamp, median } from "./geometry.js";
import { rectMean } from "./features.js";
import { bevelForSide, diagonalBevelScore } from "./candidate/bevel.js";
import { horizontalLineEvidence, strictHorizontalRatio, strictVerticalRatio, verticalLineEvidence } from "./candidate/line-evidence.js";
const MAX_ROWS = 6;
const MAX_COLS = 14;
const CELL_THRESHOLD = 0.64;
const SINGLETON_THRESHOLD = 0.74;
const FILL_THRESHOLD = 0.88;
const MODEL_LIMIT = 260;
const FIXED_RIGHT_EDGE_MARGINS = [2, 3, 5, 8, 22, 23, 30, 32, 34, 36, 43, 49, 65];
const SCALED_RIGHT_EDGE_MARGIN_RATIOS = [0.08, 0.62, 0.68, 0.74];
export function resolveGridV3Layout(features, sideCandidates, options = {}) {
    const models = buildModels(features, sideCandidates, options);
    let best = emptyLayout();
    for (const model of models.slice(0, MODEL_LIMIT)) {
        const layout = scoreModel(features, model);
        if (layout.score > best.score) {
            best = layout;
        }
    }
    return {
        ...best,
        rejected: [],
    };
}
export function resolveGridV3FromRawRows(features, rawLayout, options = {}) {
    const side = Math.round(rawLayout?.side ?? rawLayout?.detectSide ?? 0);
    const rawRows = mergeEvidenceRows(rawLayout?.rawRows ?? [], rawLayout?.rows ?? []);
    if (!side || !rawRows.length)
        return emptyLayout();
    const seedRuns = rawRows
        .filter((row) => row?.boxes?.length)
        .map((row) => ({
        y: Math.round(row.y),
        rightEdge: Math.round(row.rightEdge ?? Math.max(...row.boxes.map((box) => box.x + box.width))),
        pitch: row.pitch ? Math.round(row.pitch) : inferBoxesPitch(row.boxes, side),
        count: row.boxes.length,
        score: row.score ?? row.boxes.length,
        boxes: row.boxes.map((box) => ({
            ...box,
            side,
            width: side,
            height: side,
        })),
    }))
        .filter((run) => run.rightEdge >= features.width - side * 4.8)
        .sort((a, b) => b.score - a.score || a.y - b.y);
    if (!seedRuns.length)
        return emptyLayout();
    const models = buildModelsFromSeedRuns(features, side, seedRuns);
    let best = emptyLayout();
    for (const model of models.slice(0, MODEL_LIMIT)) {
        const layout = scoreModel(features, model);
        if (layout.score > best.score)
            best = layout;
    }
    return {
        ...best,
        rejected: rawLayout.rejected ?? [],
    };
}
export function resolveGridV3ExtendRawRows(features, rawLayout, options = {}) {
    const side = Math.round(rawLayout?.side ?? rawLayout?.detectSide ?? 0);
    const selectedRows = (rawLayout?.rows ?? []).filter((row) => row?.boxes?.length);
    const rawRows = (rawLayout?.rawRows ?? []).filter((row) => row?.boxes?.length);
    if (!side || !selectedRows.length)
        return rawLayout ?? emptyLayout();
    const rawBaseRows = selectedRows.map((row) => materializeEvidenceRow(row, side));
    let model = modelFromRows(features, side, rawBaseRows);
    model = refineModelRightEdge(features, model, rawRows);
    let baseRows = rawBaseRows
        .map((row, rowIndex) => {
        const expectedY = model.topY + rowIndex * model.rowStep;
        return fillLeftEdgeContinuation(features, model, fillRightEdgeGap(features, model, alignRowToModel(row, model, row.y), expectedY));
    })
        .filter((row) => row.boxes.length);
    if (!baseRows.length)
        return rawLayout ?? emptyLayout();
    const prependedRow = findPrependedDirectRow(features, model, baseRows);
    if (prependedRow) {
        baseRows = [prependedRow, ...baseRows];
        model = { ...model, topY: prependedRow.y };
    }
    const used = new Set(baseRows.map(rowKey));
    const rows = [...baseRows];
    for (let rowIndex = rows.length; rowIndex < MAX_ROWS; rowIndex += 1) {
        const previousRow = rows[rows.length - 1];
        const expectedY = expectedNextRowY(rows, model);
        const rawBest = previousRow
            ? findNextRawEvidenceRow(rawRows, model, previousRow.y, expectedY, used)
        : findRawEvidenceRow(rawRows, model, expectedY, used);
        const rawAligned = rawBest ? nonEmptyRow(fillLeftEdgeContinuation(features, model, fillRightEdgeGap(features, model, alignRowToModel(rawBest, model, rawBest.y), expectedY))) : null;
        const directBest = findDirectEvidenceMultiRow(features, model, expectedY);
        const best = chooseBetterEvidenceRow(rawAligned, directBest);
        if (!best) {
            const shiftedPair = previousRow ? findShiftedSingletonLookaheadPair(rawRows, model, previousRow.y, expectedY, used) : null;
            if (shiftedPair) {
                const singleton = fillLeftEdgeContinuation(features, model, fillRightEdgeGap(features, model, alignRowToModel(shiftedPair.singleton, model, shiftedPair.singleton.y), expectedY));
                const lookahead = fillLeftEdgeContinuation(features, model, fillRightEdgeGap(features, model, alignRowToModel(shiftedPair.lookahead, model, shiftedPair.lookahead.y), singleton.y + model.rowStep));
                rows.push(singleton, lookahead);
                used.add(rowKey(singleton));
                used.add(rowKey(lookahead));
                rowIndex += 1;
                continue;
            }
            const weakBridgePair = previousRow ? findWeakDirectBridgeLookaheadPair(features, rawRows, model, previousRow, expectedY, used) : null;
            if (weakBridgePair) {
                rows.push(weakBridgePair.bridge, weakBridgePair.lookahead);
                used.add(rowKey(weakBridgePair.bridge));
                used.add(rowKey(weakBridgePair.lookahead));
                rowIndex += 1;
                continue;
            }
            break;
        }
        if (best.boxes.length >= 2) {
            rows.push(best);
            used.add(rowKey(best));
            continue;
        }
        const lookaheadExpectedY = best.y + model.rowStep;
        const rawLookahead = findNextRawEvidenceRow(rawRows, model, best.y, lookaheadExpectedY, used);
        const rawAlignedLookahead = rawLookahead
            ? nonEmptyRow(fillLeftEdgeContinuation(features, model, fillRightEdgeGap(features, model, alignRowToModel(rawLookahead, model, rawLookahead.y), lookaheadExpectedY)))
            : null;
        const lookahead = chooseBetterEvidenceRow(rawAlignedLookahead, findDirectEvidenceMultiRow(features, model, lookaheadExpectedY));
        if (best.boxes.length === 1 && lookahead && lookahead.boxes.length >= 4 && isRightEdgeSingleton(best, model)) {
            rows.push(best, lookahead);
            used.add(rowKey(best));
            used.add(rowKey(lookahead));
            rowIndex += 1;
            continue;
        }
        if (best.boxes.length === 1 && !lookahead && isStrongRightEdgeSingleton(best, model, rows)) {
            rows.push(best);
            used.add(rowKey(best));
            continue;
        }
        break;
    }
    const overflowTrimmedRows = rows.map((row) => trimOverflowColumns(row, 13));
    const continuedRows = extendTwoRowRawContinuation(overflowTrimmedRows, rawRows, model);
    const weakTailTrimmedRows = trimWeakShortTerminalRow(continuedRows);
    const tailTrimmedRows = trimCompressedTerminalTailRow(weakTailTrimmedRows, model);
    const weakLeadingTrimmedRows = trimWeakLeadingCellsBeforeDenseNextRow(tailTrimmedRows);
    const finalizedRows = trimFalseLeadingCellsByNeighborContext(weakLeadingTrimmedRows);
    const normalizedRows = finalizedRows.map((row, rowIndex) => ({
        ...row,
        boxes: row.boxes.map((box, col) => ({ ...box, row: rowIndex, col })),
    }));
    const boxes = normalizedRows.flatMap((row) => row.boxes);
    return {
        side,
        detectSide: side,
        boxes,
        rows: normalizedRows,
        rawRows,
        rejected: rawLayout.rejected ?? [],
        score: (rawLayout.score ?? 0) + (finalizedRows.length - baseRows.length) * 2,
        grid: {
            version: "v3-extend",
            confidence: rawLayout.grid?.confidence ?? 0.9,
            model,
            rowCounts: normalizedRows.map((row) => row.boxes.length),
            baseRowCount: baseRows.length,
            extendedRowCount: finalizedRows.length - baseRows.length,
        },
    };
}
export function isGridV3Confident(layout) {
    if (!layout?.boxes?.length || !layout?.grid)
        return false;
    return layout.grid.confidence >= 0.86 && layout.boxes.length >= 2;
}
function mergeEvidenceRows(rawRows, selectedRows) {
    const rows = [];
    for (const row of [...rawRows, ...selectedRows]) {
        if (!row?.boxes?.length)
            continue;
        const duplicate = rows.some((existing) => Math.abs(existing.y - row.y) <= 2 &&
            Math.abs((existing.rightEdge ?? 0) - (row.rightEdge ?? 0)) <= 3 &&
            existing.boxes.length === row.boxes.length);
        if (!duplicate)
            rows.push(row);
    }
    return rows;
}
function materializeEvidenceRow(row, side) {
    const boxes = row.boxes
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((box, col) => ({
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: side,
        height: side,
        side,
        score: clamp(box.score ?? box.confidence ?? 0.86, 0, 1),
        confidence: clamp(box.confidence ?? box.score ?? 0.86, 0, 1),
        row: 0,
        col,
        source: box.source ?? "grid-v3:raw-row",
    }));
    const y = Math.round(row.y ?? median(boxes.map((box) => box.y)));
    return {
        y,
        bottom: y + side,
        rightEdge: Math.round(row.rightEdge ?? Math.max(...boxes.map((box) => box.x + box.width))),
        pitch: Math.round(row.pitch ?? inferBoxesPitch(boxes, side) ?? side),
        boxes,
        score: row.score ?? boxes.reduce((sum, box) => sum + box.score, 0),
    };
}
function alignRowToModel(row, model, expectedY) {
    const byColumn = new Map();
    const xTolerance = Math.max(3, model.side * 0.25);
    const snappedY = Math.round(expectedY);
    for (const box of row.boxes) {
        const colFromRight = Math.round((model.rightEdge - model.side - box.x) / model.pitch);
        if (colFromRight < 0 || colFromRight >= MAX_COLS)
            continue;
        const expectedX = Math.round(model.rightEdge - model.side - colFromRight * model.pitch);
        const xDelta = Math.abs(box.x - expectedX);
        if (xDelta > xTolerance)
            continue;
        const xFit = clamp(1 - xDelta / Math.max(1, xTolerance), 0, 1);
        const adjustedScore = clamp(box.score * 0.82 + xFit * 0.18, 0, 1);
        const current = byColumn.get(colFromRight);
        if (!current || adjustedScore > current.score) {
            byColumn.set(colFromRight, {
                ...box,
                x: expectedX,
            y: snappedY,
                width: model.side,
                height: model.side,
                side: model.side,
                score: adjustedScore,
                confidence: adjustedScore,
                col: colFromRight,
                gridCol: colFromRight,
                source: box.source === "grid-v3:raw-row" ? "grid-v3:grid-aligned" : box.source,
            });
        }
    }
    const boxes = [...byColumn.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, box]) => box);
    return {
        y: snappedY,
        bottom: snappedY + model.side,
        rightEdge: model.rightEdge,
        pitch: model.pitch,
        boxes,
        score: boxes.reduce((sum, box) => sum + box.score, 0),
    };
}
function fillRightEdgeGap(features, model, row, expectedY, options = {}) {
    row = fillInteriorColumnGaps(features, model, row);
    row = trimWeakLeadingRowCells(row);
    const minCells = options.minCells ?? 6;
    const scoreThreshold = options.scoreThreshold ?? 0.58;
    const borderThreshold = options.borderThreshold ?? 0.48;
    if (row.boxes.length < minCells)
        return row;
    const cols = row.boxes.map(gridColumn).filter(isNumber);
    if (!cols.length)
        return row;
    const minCol = Math.min(...cols);
    if (minCol <= 0 || minCol > 2)
        return row;
    const output = [...row.boxes];
    for (let colFromRight = minCol - 1; colFromRight >= 0; colFromRight -= 1) {
        const x = Math.round(model.rightEdge - model.side - colFromRight * model.pitch);
        const y = Math.round(row.y);
        const cell = bestCellAt(features, x, y, model.side);
        if (cell.score < scoreThreshold || cell.borderScore < borderThreshold)
            break;
        output.push({
            x,
            y,
            width: model.side,
            height: model.side,
            side: model.side,
            score: cell.score,
            confidence: cell.score,
            row: 0,
            col: colFromRight,
            gridCol: colFromRight,
            source: `grid-v3:right-edge-fill:${round3(cell.borderScore)}/${round3(cell.centerScore)}`,
            synthetic: true,
        });
    }
    return trimWeakLeadingRowCells({
        ...row,
        boxes: output.sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0)),
        score: output.reduce((sum, box) => sum + box.score, 0),
    });
}
function fillLeftEdgeContinuation(features, model, row, maxColumns = 13) {
    if (row.boxes.length < 6 || row.boxes.length >= maxColumns)
        return row;
    const cols = row.boxes.map(gridColumn).filter(isNumber);
    if (!cols.length || Math.min(...cols) !== 0)
        return row;
    const output = [...row.boxes];
    let nextCol = Math.max(...cols) + 1;
    while (nextCol < maxColumns) {
        const x = Math.round(model.rightEdge - model.side - nextCol * model.pitch);
        const cell = bestCellAt(features, x, row.y, model.side);
        if (cell.score < 0.94 || cell.borderScore < 0.88)
            break;
        output.push({
            x,
            y: Math.round(row.y),
            width: model.side,
            height: model.side,
            side: model.side,
            score: cell.score,
            confidence: cell.score,
            row: 0,
            col: nextCol,
            gridCol: nextCol,
            source: `grid-v3:left-continuation:${round3(cell.borderScore)}/${round3(cell.centerScore)}`,
            synthetic: true,
        });
        nextCol += 1;
    }
    if (output.length === row.boxes.length)
        return row;
    return trimWeakLeadingRowCells({
        ...row,
        boxes: output.sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0)),
        score: output.reduce((sum, box) => sum + box.score, 0),
    });
}
function fillInteriorColumnGaps(features, model, row) {
    if (row.boxes.length < 4)
        return row;
    const byCol = new Map();
    for (const box of row.boxes) {
        const col = gridColumn(box);
        if (col === null)
            continue;
        const current = byCol.get(col);
        if (!current || box.score > current.score)
            byCol.set(col, box);
    }
    if (byCol.size < 4)
        return row;
    const cols = [...byCol.keys()].sort((a, b) => a - b);
    const minCol = cols[0];
    const maxCol = cols[cols.length - 1];
    const output = [...row.boxes];
    let filled = 0;
    for (let colFromRight = minCol + 1; colFromRight < maxCol; colFromRight += 1) {
        if (byCol.has(colFromRight))
            continue;
        if (!byCol.has(colFromRight - 1) || !byCol.has(colFromRight + 1))
            continue;
        const x = Math.round(model.rightEdge - model.side - colFromRight * model.pitch);
        const cell = bestCellAt(features, x, row.y, model.side);
        if (cell.score < 0.84 || cell.borderScore < 0.62)
            continue;
        output.push({
            x,
            y: Math.round(row.y),
            width: model.side,
            height: model.side,
            side: model.side,
            score: cell.score,
            confidence: cell.score,
            row: 0,
            col: colFromRight,
            gridCol: colFromRight,
            source: `grid-v3:interior-fill:${round3(cell.borderScore)}/${round3(cell.centerScore)}`,
            synthetic: true,
        });
        filled += 1;
        if (filled >= 2)
            break;
    }
    if (!filled)
        return row;
    return {
        ...row,
        boxes: output.sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0)),
        score: output.reduce((sum, box) => sum + box.score, 0),
    };
}
function gridColumn(box) {
    const col = box.gridCol ?? box.col;
    return Number.isFinite(col) ? Number(col) : null;
}
function trimWeakLeadingRowCells(row) {
    if (row.boxes.length < 2)
        return row;
    const boxes = [...row.boxes].sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0));
    let start = 0;
    if (boxes.length <= 5) {
        if (boxes.length <= 3)
            return row;
        while (start < boxes.length && boxes[start].score < 0.91) {
            start += 1;
        }
    }
    else {
        while (start < boxes.length - 5 && isWeakLeadingBoundaryCell(boxes, start)) {
            start += 1;
        }
    }
    if (start === 0)
        return row;
    const kept = boxes.slice(start);
    return {
        ...row,
        boxes: kept,
        score: kept.reduce((sum, box) => sum + box.score, 0),
    };
}
function trimOverflowColumns(row, maxColumns) {
    if (row.boxes.length <= maxColumns)
        return row;
    const boxes = [...row.boxes].sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0));
    const kept = boxes.slice(boxes.length - maxColumns);
    return {
        ...row,
        boxes: kept,
        score: kept.reduce((sum, box) => sum + box.score, 0),
    };
}
function extendTwoRowRawContinuation(rows, rawRows, model) {
    if (rows.length !== 2)
        return rows;
    const [topRow, targetRow] = rows;
    if (topRow.boxes.length < 10 || targetRow.boxes.length < 5 || targetRow.boxes.length > 6)
        return rows;
    const existingCols = targetRow.boxes.map(gridColumn).filter(isNumber);
    if (!existingCols.length || Math.min(...existingCols) !== 0)
        return rows;
    const maxCol = Math.max(...existingCols);
    const yTolerance = Math.max(2, model.side * 0.12);
    const xTolerance = Math.max(3, model.side * 0.24);
    const additions = new Map();
    for (const raw of rawRows) {
        const fragment = materializeEvidenceRow(raw, model.side);
        if (fragment.boxes.length > 2 || Math.abs(fragment.y - targetRow.y) > yTolerance)
            continue;
        for (const box of fragment.boxes) {
            const colFromRight = Math.round((model.rightEdge - model.side - box.x) / model.pitch);
            if (colFromRight <= maxCol || colFromRight > maxCol + 2 || colFromRight >= MAX_COLS)
                continue;
            const expectedX = Math.round(model.rightEdge - model.side - colFromRight * model.pitch);
            const xDelta = Math.abs(box.x - expectedX);
            if (xDelta > xTolerance)
                continue;
            const xFit = clamp(1 - xDelta / Math.max(1, xTolerance), 0, 1);
            const score = clamp(box.score * 0.82 + xFit * 0.18, 0, 1);
            const current = additions.get(colFromRight);
            if (!current || score > current.score) {
                additions.set(colFromRight, {
                    ...box,
                    x: expectedX,
                    y: targetRow.y,
                    width: model.side,
                    height: model.side,
                    side: model.side,
                    score,
                    confidence: score,
                    col: colFromRight,
                    gridCol: colFromRight,
                    source: "grid-v3:two-row-raw-continuation",
                });
            }
        }
    }
    const appended = [];
    for (let col = maxCol + 1; col <= maxCol + 2; col += 1) {
        const cell = additions.get(col);
        if (!cell)
            break;
        appended.push(cell);
    }
    if (!appended.length)
        return rows;
    const boxes = [...targetRow.boxes, ...appended].sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0));
    const output = [...rows];
    output[1] = {
        ...targetRow,
        boxes,
        score: boxes.reduce((sum, box) => sum + box.score, 0),
    };
    return output;
}
function trimCompressedTerminalTailRow(rows, model) {
    if (rows.length < 5)
        return rows;
    const last = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    if (!last || !previous || last.boxes.length < 1 || last.boxes.length > 2 || previous.boxes.length < 7)
        return rows;
    const gap = last.y - previous.y;
    if (gap > model.rowStep * 0.9 || gap > model.side)
        return rows;
    return rows.slice(0, -1);
}
function trimWeakShortTerminalRow(rows) {
    if (rows.length !== 2)
        return rows;
    const [first, last] = rows;
    if (!first || !last || first.boxes.length > 4 || last.boxes.length < 2 || last.boxes.length > 3)
        return rows;
    const firstStrong = first.boxes.every((box) => box.score >= 0.92);
    const lastWeak = last.boxes.every((box) => box.score < 0.8);
    return firstStrong && lastWeak ? rows.slice(0, -1) : rows;
}
function trimWeakLeadingCellsBeforeDenseNextRow(rows) {
    return rows.map((row, index) => {
        const next = rows[index + 1];
        if (!next || row.boxes.length < 2 || row.boxes.length > 7 || next.boxes.length < 10)
            return row;
        const boxes = [...row.boxes].sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0));
        const leading = boxes[0];
        if (!leading || leading.score >= 0.93)
            return row;
        const kept = boxes.slice(1);
        return {
            ...row,
            boxes: kept,
            score: kept.reduce((sum, box) => sum + box.score, 0),
        };
    });
}
function trimFalseLeadingCellsByNeighborContext(rows) {
    return rows.map((row, index) => {
        const trimCount = falseLeadingTrimCount(rows, index);
        if (!trimCount)
            return row;
        const boxes = [...row.boxes].sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0));
        const kept = boxes.slice(trimCount);
        return {
            ...row,
            boxes: kept,
            score: kept.reduce((sum, box) => sum + box.score, 0),
        };
    });
}
function falseLeadingTrimCount(rows, index) {
    const row = rows[index];
    const previous = rows[index - 1];
    const next = rows[index + 1];
    if (!row || !previous || !next || row.boxes.length < 3)
        return 0;
    const boxes = [...row.boxes].sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0));
    const leading = boxes[0];
    const second = boxes[1];
    const rowMaxCol = gridColumn(leading);
    const nextMaxCol = maxGridColumn(next);
    if (!isNumber(rowMaxCol) || !isNumber(nextMaxCol))
        return 0;
    const previousShort = rows[index - 2];
    if (row.boxes.length >= 3 &&
        row.boxes.length <= 4 &&
        previous.boxes.length >= 10 &&
        previousShort &&
        previousShort.boxes.length <= row.boxes.length &&
        next.boxes.length - row.boxes.length === 2 &&
        nextMaxCol - rowMaxCol === 2 &&
        leading.score < 0.98) {
        return 1;
    }
    if (row.boxes.length === 3 &&
        previous.boxes.length >= 10 &&
        next.boxes.length === 7 &&
        nextMaxCol - rowMaxCol === 4 &&
        rowSide(row) <= 36 &&
        leading.score < 0.99) {
        return 1;
    }
    if (row.boxes.length === 7 &&
        previous.boxes.length >= 10 &&
        next.boxes.length >= 10 &&
        String(leading.source ?? "").includes("left-continuation") &&
        leading.score < 0.96 &&
        second &&
        second.score < 0.97) {
        return 2;
    }
    return 0;
}
function maxGridColumn(row) {
    const cols = row.boxes.map(gridColumn).filter(isNumber);
    return cols.length ? Math.max(...cols) : null;
}
function rowSide(row) {
    return row.boxes[0]?.side ?? 0;
}
function isWeakLeadingBoundaryCell(boxes, index) {
    const cell = boxes[index];
    const neighbors = boxes.slice(index + 1, Math.min(boxes.length, index + 5));
    if (!neighbors.length)
        return false;
    const neighborScore = median(neighbors.map((box) => box.score));
    return cell.score < 0.91 && neighborScore >= 0.94 && cell.score <= neighborScore - 0.05;
}
function isStrongRightEdgeSingleton(row, model, previousRows) {
    if (row.boxes.length !== 1 || previousRows.length < 1)
        return false;
    const previousStrongRow = previousRows.some((previous) => previous.boxes.length >= 2);
    return previousStrongRow && isRightEdgeSingleton(row, model, { minScore: 0.9, minXFit: 0.62, xToleranceScale: 0.2 });
}
function modelFromRows(features, side, rows) {
    const topY = rows[0]?.y ?? 0;
    const pitch = Math.round(median(rows.map((row) => row.pitch).filter(isNumber))) || Math.round(side * 0.94);
    const rowStep = inferRowsStep(rows, side) ?? Math.round(side * 1.1);
    const rightEdge = Math.round(median(rows.map((row) => row.rightEdge).filter((edge) => edge >= features.width - side * 4.8))) || rows[0].rightEdge;
    return {
        side,
        topY,
        rightEdge,
        pitch,
        rowStep,
        seedScore: 1,
        seedRuns: [],
    };
}
function refineModelRightEdge(features, model, rawRows) {
    const evidenceRows = rawRows.map((row) => materializeEvidenceRow(row, model.side)).filter((row) => row.boxes.length >= 2);
    if (!evidenceRows.length)
        return model;
    const candidates = uniqueNear([
        model.rightEdge,
        ...evidenceRows.map((row) => row.rightEdge),
        ...knownRightEdges(features, model.side),
    ], Math.max(2, model.side * 0.12)).filter((edge) => edge >= features.width - model.side * 4.8 && edge <= features.width + 1);
    if (candidates.length < 2)
        return model;
    const currentScore = rightEdgeModelScore(features, model, evidenceRows, model.rightEdge);
    const best = candidates
        .map((edge) => ({ edge, score: rightEdgeModelScore(features, model, evidenceRows, edge) }))
        .sort((a, b) => b.score - a.score || rightEdgePrior(features, b.edge, model.side) - rightEdgePrior(features, a.edge, model.side))[0];
    if (!best || best.edge === model.rightEdge || best.score < currentScore + 0.75)
        return model;
    return { ...model, rightEdge: best.edge };
}
function rightEdgeModelScore(features, model, rows, rightEdge) {
    const candidateModel = { ...model, rightEdge };
    const xTolerance = Math.max(3, model.side * 0.3);
    let score = rightEdgePrior(features, rightEdge, model.side) * 2.2;
    for (const row of rows) {
        let aligned = 0;
        for (const box of row.boxes) {
            const colFromRight = Math.round((rightEdge - model.side - box.x) / model.pitch);
            if (colFromRight < 0 || colFromRight >= MAX_COLS)
                continue;
            const expectedX = Math.round(rightEdge - model.side - colFromRight * model.pitch);
            const xDelta = Math.abs(box.x - expectedX);
            if (xDelta > xTolerance)
                continue;
            aligned += clamp(1 - xDelta / xTolerance, 0, 1) * clamp(box.score ?? 0.8, 0, 1);
        }
        if (aligned >= Math.min(2, row.boxes.length)) {
            score += aligned * (row.boxes.length >= 4 ? 1 : 0.55) * edgeAlignmentFit(row.rightEdge, candidateModel);
        }
    }
    return score;
}
function knownRightEdges(features, side) {
    return rightEdgeMargins(side).map((margin) => features.width - margin);
}
function inferRowsStep(rows, side) {
    const steps = diffs(rows.map((row) => row.y).sort((a, b) => a - b)).filter((value) => value >= side * 0.86 && value <= side * 1.35);
    return steps.length ? Math.round(median(steps)) : null;
}
function expectedNextRowY(rows, model) {
    const previous = rows[rows.length - 1];
    return previous ? previous.y + model.rowStep : model.topY;
}
function findRawEvidenceRow(rawRows, model, expectedY, used) {
    const candidates = rawRows
        .map((row) => materializeEvidenceRow(row, model.side))
        .filter((row) => !used.has(rowKey(row)))
        .filter((row) => row.boxes.length !== 1 || isRawRightEdgeSingleton(row, model))
        .map((row) => {
        const yFit = clamp(1 - Math.abs(row.y - expectedY) / Math.max(1, model.side * 0.36), 0, 1);
        const rightFit = edgeAlignmentFit(row.rightEdge, model);
        const pitchFit = row.pitch ? clamp(1 - Math.abs(row.pitch - model.pitch) / Math.max(1, model.side * 0.24), 0, 1) : 0.65;
        const countFit = clamp(row.boxes.length / 7, 0, 1);
        const score = yFit * 0.48 + rightFit * 0.27 + pitchFit * 0.13 + countFit * 0.12;
        return { row, score };
    })
        .filter((entry) => entry.score >= 0.64 && entry.row.rightEdge >= model.rightEdge - model.pitch * 1.35)
        .sort((a, b) => b.score - a.score || b.row.boxes.length - a.row.boxes.length);
    return candidates[0]?.row ?? null;
}
function findNextRawEvidenceRow(rawRows, model, previousY, expectedY, used) {
    const minGap = model.side * 0.9;
    const maxGap = model.side * 1.48;
    const candidates = rawRows
        .map((row) => materializeEvidenceRow(row, model.side))
        .filter((row) => !used.has(rowKey(row)))
        .filter((row) => {
        const gap = row.y - previousY;
        return gap >= minGap && gap <= maxGap;
    })
        .filter((row) => row.boxes.length !== 1 || isRawRightEdgeSingleton(row, model))
        .map((row) => {
        const gap = row.y - previousY;
        const gapFit = clamp(1 - Math.abs(gap - model.rowStep) / Math.max(1, model.side * 0.48), 0, 1);
        const yFit = clamp(1 - Math.abs(row.y - expectedY) / Math.max(1, model.side * 0.52), 0, 1);
        const rightFit = edgeAlignmentFit(row.rightEdge, model);
        const pitchFit = row.pitch ? clamp(1 - Math.abs(row.pitch - model.pitch) / Math.max(1, model.side * 0.24), 0, 1) : 0.65;
        const countFit = clamp(row.boxes.length / 7, 0, 1);
        const score = gapFit * 0.3 + yFit * 0.22 + rightFit * 0.25 + pitchFit * 0.13 + countFit * 0.1;
        return { row, score };
    })
        .filter((entry) => entry.score >= 0.62 && entry.row.rightEdge >= model.rightEdge - model.pitch * 1.35)
        .sort((a, b) => b.score - a.score || b.row.boxes.length - a.row.boxes.length);
    return candidates[0]?.row ?? null;
}
function chooseBetterEvidenceRow(rawRow, directRow) {
    if (!rawRow)
        return directRow;
    if (!directRow)
        return rawRow;
    if (directRow.boxes.length >= rawRow.boxes.length + 3)
        return directRow;
    if (rawRow.boxes.length < 4 && directRow.boxes.length >= 4)
        return directRow;
    return rawRow;
}
function nonEmptyRow(row) {
    return row?.boxes?.length ? row : null;
}
function findShiftedSingletonLookaheadPair(rawRows, model, previousY, expectedY, used) {
    const rows = rawRows
        .map((row) => materializeEvidenceRow(row, model.side))
        .filter((row) => !used.has(rowKey(row)) && row.rightEdge >= model.rightEdge - model.pitch * 1.35);
    const maxShift = Math.max(7, model.side * 0.44);
    const minGap = model.side * 0.9;
    const maxGap = model.side * 1.48;
    const singletons = rows.filter((row) => {
        if (row.boxes.length !== 1)
            return false;
        const gap = row.y - previousY;
        if (gap < minGap || gap > maxGap)
            return false;
        const delta = row.y - expectedY;
        return Math.abs(delta) <= maxShift && isRawRightEdgeSingleton(row, model);
    });
    const lookaheads = rows.filter((row) => row.boxes.length >= 4 && rowPitchFit(row, model) >= 0.48 && edgeAlignmentFit(row.rightEdge, model) >= 0.55);
    let best = null;
    for (const singleton of singletons) {
        const singletonGap = singleton.y - previousY;
        const singletonGapFit = clamp(1 - Math.abs(singletonGap - model.rowStep) / Math.max(1, model.side * 0.48), 0, 1);
        const singletonYFit = clamp(1 - Math.abs(singleton.y - expectedY) / Math.max(1, model.side * 0.52), 0, 1);
        for (const lookahead of lookaheads) {
            const gap = lookahead.y - singleton.y;
            if (gap < minGap || gap > maxGap)
                continue;
            const lookaheadExpectedY = singleton.y + model.rowStep;
            const lookaheadDelta = lookahead.y - lookaheadExpectedY;
            if (Math.abs(lookaheadDelta) > maxShift)
                continue;
            const lookaheadGapFit = clamp(1 - Math.abs(gap - model.rowStep) / Math.max(1, model.side * 0.48), 0, 1);
            const lookaheadYFit = clamp(1 - Math.abs(lookaheadDelta) / Math.max(1, model.side * 0.52), 0, 1);
            const score = singletonGapFit * 0.18 +
                singletonYFit * 0.12 +
                lookaheadGapFit * 0.16 +
                lookaheadYFit * 0.1 +
                edgeAlignmentFit(singleton.rightEdge, model) * 0.18 +
                edgeAlignmentFit(lookahead.rightEdge, model) * 0.16 +
                rowPitchFit(lookahead, model) * 0.12 +
                clamp(lookahead.boxes.length / 8, 0, 1) * 0.08;
            if (!best || score > best.score) {
                best = { singleton, lookahead, score };
            }
        }
    }
    return best ? { singleton: best.singleton, lookahead: best.lookahead } : null;
}
function findDirectEvidenceMultiRow(features, model, expectedY) {
    const yRadius = Math.max(3, Math.round(model.side * 0.2));
    let best = null;
    for (let y = Math.round(expectedY - yRadius); y <= Math.round(expectedY + yRadius); y += 1) {
        const boxes = [];
        let weakBridgeUsed = false;
        for (let colFromRight = 0; colFromRight < MAX_COLS; colFromRight += 1) {
            const x = Math.round(model.rightEdge - model.side - colFromRight * model.pitch);
            const cell = bestCellAt(features, x, y, model.side);
            const strong = isStrongDirectCell(cell);
            if (!strong) {
                if (weakBridgeUsed || !isDirectInteriorBridgeCell(features, model, y, colFromRight, cell, boxes))
                    break;
                weakBridgeUsed = true;
            }
            boxes.push({
                x: Math.round(cell.x),
                y: Math.round(cell.y),
                width: model.side,
                height: model.side,
                side: model.side,
                score: cell.score,
                confidence: cell.score,
                row: 0,
                col: colFromRight,
                gridCol: colFromRight,
                source: strong ? `grid-v3:direct-row:${round3(cell.borderScore)}/${round3(cell.centerScore)}` : `grid-v3:direct-row-bridge:${round3(cell.borderScore)}/${round3(cell.centerScore)}`,
                synthetic: true,
            });
        }
        if (boxes.length < 4)
            continue;
        const rowY = Math.round(median(boxes.map((box) => box.y)));
        const row = {
            y: rowY,
            bottom: rowY + model.side,
            rightEdge: model.rightEdge,
            pitch: model.pitch,
            boxes: boxes.map((box) => ({ ...box, y: rowY })).sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0)),
            score: boxes.reduce((sum, box) => sum + box.score, 0),
        };
        if (!best || row.score > best.score)
            best = row;
    }
    return best;
}
function findWeakDirectBridgeLookaheadPair(features, rawRows, model, previousRow, expectedY, used) {
    if (previousRow.boxes.length < 8)
        return null;
    const bridge = findWeakDirectBridgeRow(features, model, expectedY);
    if (!bridge)
        return null;
    const lookaheadExpectedY = bridge.y + model.rowStep;
    const rawLookahead = findNextRawEvidenceRow(rawRows, model, bridge.y, lookaheadExpectedY, used);
    const rawAlignedLookahead = rawLookahead
        ? nonEmptyRow(fillLeftEdgeContinuation(features, model, fillRightEdgeGap(features, model, alignRowToModel(rawLookahead, model, rawLookahead.y), lookaheadExpectedY)))
        : null;
    const lookahead = chooseBetterEvidenceRow(rawAlignedLookahead, findDirectEvidenceMultiRow(features, model, lookaheadExpectedY));
    if (!lookahead || lookahead.boxes.length < 4)
        return null;
    return { bridge, lookahead };
}
function findWeakDirectBridgeRow(features, model, expectedY) {
    const yRadius = Math.max(3, Math.round(model.side * 0.18));
    let best = null;
    for (let y = Math.round(expectedY - yRadius); y <= Math.round(expectedY + yRadius); y += 1) {
        const boxes = [];
        for (let colFromRight = 0; colFromRight < 3; colFromRight += 1) {
            const x = Math.round(model.rightEdge - model.side - colFromRight * model.pitch);
            const cell = bestCellAt(features, x, y, model.side);
            if (!isWeakBridgeCell(cell))
                break;
            boxes.push({
                x: Math.round(cell.x),
                y: Math.round(cell.y),
                width: model.side,
                height: model.side,
                side: model.side,
                score: cell.score,
                confidence: cell.score,
                row: 0,
                col: colFromRight,
                gridCol: colFromRight,
                source: `grid-v3:weak-direct-bridge:${round3(cell.borderScore)}/${round3(cell.centerScore)}`,
                synthetic: true,
            });
        }
        if (!boxes.length || (boxes.length === 1 && boxes[0].score < 0.9))
            continue;
        const rowY = Math.round(median(boxes.map((box) => box.y)));
        const row = {
            y: rowY,
            bottom: rowY + model.side,
            rightEdge: model.rightEdge,
            pitch: model.pitch,
            boxes: boxes.map((box) => ({ ...box, y: rowY })).sort((a, b) => (gridColumn(b) ?? 0) - (gridColumn(a) ?? 0)),
            score: boxes.reduce((sum, box) => sum + box.score, 0),
        };
        if (!best || row.score > best.score)
            best = row;
    }
    return best;
}
function isStrongDirectCell(cell) {
    return cell.score >= 0.9 && cell.borderScore >= 0.86;
}
function isWeakBridgeCell(cell) {
    return cell.score >= 0.84 && cell.borderScore >= 0.82;
}
function isDirectInteriorBridgeCell(features, model, y, colFromRight, cell, boxes) {
    if (boxes.length < 2 || colFromRight + 1 >= MAX_COLS)
        return false;
    if (cell.score < 0.84 || cell.borderScore < 0.82)
        return false;
    const nextX = Math.round(model.rightEdge - model.side - (colFromRight + 1) * model.pitch);
    const nextCell = bestCellAt(features, nextX, y, model.side);
    return isStrongDirectCell(nextCell);
}
function findPrependedDirectRow(features, model, rows) {
    if (!rows.length || rows[0].y <= model.side * 0.35)
        return null;
    const expectedY = rows[0].y - model.rowStep;
    if (expectedY < -model.side * 0.2)
        return null;
    const directRow = findDirectEvidenceMultiRow(features, model, expectedY);
    if (!directRow || directRow.boxes.length < 4)
        return null;
    const gap = rows[0].y - directRow.y;
    if (gap < model.side * 0.86 || gap > model.side * 1.35)
        return null;
    return directRow;
}
function isRawRightEdgeSingleton(row, model) {
    return isRightEdgeSingleton(row, model, { minScore: 0.84, minXFit: 0.55, minEdgeFit: 0.55, xToleranceScale: 0.24 });
}
function isRightEdgeSingleton(row, model, options = {}) {
    if (row.boxes.length !== 1)
        return false;
    const [box] = row.boxes;
    const colFromRight = Math.round((model.rightEdge - model.side - box.x) / model.pitch);
    if (colFromRight !== 0)
        return false;
    const expectedX = Math.round(model.rightEdge - model.side);
    const xToleranceScale = options.xToleranceScale ?? 0.24;
    const xFit = clamp(1 - Math.abs(box.x - expectedX) / Math.max(1, model.side * xToleranceScale), 0, 1);
    return (box.score >= (options.minScore ?? 0.84) &&
        xFit >= (options.minXFit ?? 0.55) &&
        edgeAlignmentFit(row.rightEdge, model) >= (options.minEdgeFit ?? 0.55));
}
function rowPitchFit(row, model) {
    if (!row.pitch)
        return row.boxes.length >= 4 ? 0.65 : 0;
    return clamp(1 - Math.abs(row.pitch - model.pitch) / Math.max(1, model.side * 0.24), 0, 1);
}
function rowKey(row) {
    return `${Math.round(row.y)}:${Math.round(row.rightEdge)}:${row.boxes.length}`;
}
function buildModels(features, sideCandidates, options) {
    const models = [];
    const strictCandidates = (options.seedCandidates ?? options.strictCandidates ?? []);
    for (const side of normalizeSides(sideCandidates)) {
        const seedRuns = buildSeedRuns(features, strictCandidates, side);
        if (!seedRuns.length)
            continue;
        models.push(...buildModelsFromSeedRuns(features, side, seedRuns));
    }
    return models.sort((a, b) => modelPrior(features, b) - modelPrior(features, a));
}
function buildModelsFromSeedRuns(features, side, seedRuns) {
    const models = [];
    const rightEdges = rightEdgeCandidates(features, side, seedRuns);
    const topYs = topYCandidates(features, side, seedRuns);
    const pitches = uniqueNear([...seedRuns.map((run) => run.pitch).filter(isNumber), side, Math.round(side * 0.94), Math.round(side * 0.97)], Math.max(1, side * 0.04)).filter((value) => value >= side * 0.86 && value <= side * 1.08);
    const rowSteps = uniqueNear([...inferSeedRowSteps(seedRuns, side), side, Math.round(side * 1.06), Math.round(side * 1.1), Math.round(side * 1.15)], Math.max(1, side * 0.04)).filter((value) => value >= side * 0.96 && value <= side * 1.24);
    for (const rightEdge of rightEdges) {
        for (const topY of topYs) {
            for (const pitch of pitches) {
                for (const rowStep of rowSteps) {
                    const model = { side, rightEdge, topY, pitch, rowStep, seedScore: 0, seedRuns };
                    model.seedScore = seedModelScore(seedRuns, model);
                    models.push(model);
                }
            }
        }
    }
    return models;
}
function buildSeedRuns(features, candidates, side) {
    const tolerance = Math.max(2, Math.round(side * 0.09));
    const sameSize = candidates.filter((candidate) => Math.abs((candidate.side ?? candidate.width) - side) <= tolerance);
    const rowGroups = groupByNear(sameSize, Math.max(3, side * 0.25), (candidate) => candidate.y);
    const runs = [];
    for (const rowGroup of rowGroups) {
        const y = Math.round(median(rowGroup.items.map((candidate) => candidate.y)));
        const sorted = rowGroup.items.slice().sort((a, b) => a.x - b.x || b.score - a.score);
        let current = [];
        for (const candidate of sorted) {
            const previous = current[current.length - 1];
            if (previous && candidate.x - previous.x > side * 1.42) {
                pushRun(runs, current, y, side);
                current = [];
            }
            current.push(candidate);
        }
        pushRun(runs, current, y, side);
    }
    return runs
        .filter((run) => run.rightEdge >= features.width - side * 4.5)
        .sort((a, b) => b.score - a.score || a.y - b.y || b.rightEdge - a.rightEdge);
}
function pushRun(runs, boxes, y, side) {
    if (!boxes.length)
        return;
    const xs = boxes.map((box) => box.x).sort((a, b) => a - b);
    const pitchValues = diffs(xs).filter((value) => value >= side * 0.7 && value <= side * 1.35);
    const pitch = pitchValues.length ? median(pitchValues) : null;
    const count = boxes.length;
    const rightEdge = Math.max(...boxes.map((box) => box.x + box.width));
    const score = boxes.reduce((sum, box) => sum + box.score, 0) / Math.max(1, boxes.length) + Math.sqrt(count) * 0.28;
    runs.push({
        y,
        rightEdge,
        pitch,
        count,
        score,
        boxes,
    });
}
function inferBoxesPitch(boxes, side) {
    const xs = boxes.map((box) => box.x).sort((a, b) => a - b);
    const pitchValues = diffs(xs).filter((value) => value >= side * 0.7 && value <= side * 1.35);
    return pitchValues.length ? median(pitchValues) : null;
}
function inferSeedRowSteps(seedRuns, side) {
    const rowYs = uniqueNear(seedRuns.map((run) => run.y), Math.max(2, side * 0.16)).sort((a, b) => a - b);
    return diffs(rowYs).filter((value) => value >= side * 0.82 && value <= side * 1.32);
}
function seedModelScore(seedRuns, model) {
    let score = 0;
    let possible = 0;
    for (let rowIndex = 0; rowIndex < MAX_ROWS; rowIndex += 1) {
        const y = model.topY + rowIndex * model.rowStep;
        const best = seedRuns
            .map((run) => {
            const yFit = clamp(1 - Math.abs(run.y - y) / Math.max(1, model.side * 0.28), 0, 1);
            const rightFit = edgeAlignmentFit(run.rightEdge, model);
            const pitchFit = run.pitch ? clamp(1 - Math.abs(run.pitch - model.pitch) / Math.max(1, model.side * 0.22), 0, 1) : 0.65;
            return yFit * 0.45 + rightFit * 0.3 + pitchFit * 0.15 + clamp(run.count / 8, 0, 1) * 0.1;
        })
            .sort((a, b) => b - a)[0] ?? 0;
        if (best > 0.2) {
            score += best;
            possible += 1;
        }
    }
    return possible ? clamp(score / possible, 0, 1) : 0;
}
function edgeAlignmentFit(seedRightEdge, model) {
    const tolerance = Math.max(1, model.side * 0.42);
    const deltas = [
        Math.abs(seedRightEdge - model.rightEdge),
        Math.abs(seedRightEdge + model.pitch - model.rightEdge),
        Math.abs(seedRightEdge - model.pitch - model.rightEdge),
    ];
    return clamp(1 - Math.min(...deltas) / tolerance, 0, 1);
}
function scoreModel(features, model) {
    const rows = [];
    let score = 0;
    let previousActive = false;
    let emptyAfterActive = 0;
    for (let rowIndex = 0; rowIndex < MAX_ROWS; rowIndex += 1) {
        const y = Math.round(model.topY + rowIndex * model.rowStep);
        if (y + model.side > features.height + model.side * 0.25)
            break;
        const row = scoreSeedRow(features, model, rowIndex, y);
        const active = isActiveRow(row, previousActive);
        if (active) {
            rows.push(row);
            score += row.score;
            previousActive = true;
            emptyAfterActive = 0;
        }
        else if (previousActive) {
            emptyAfterActive += 1;
            if (emptyAfterActive >= 1)
                break;
        }
    }
    const normalizedRows = rows.map((row, rowIndex) => ({
        ...row,
        boxes: row.boxes
            .slice()
            .sort((a, b) => a.x - b.x)
            .map((box, col) => ({ ...box, row: rowIndex, col })),
    }));
    const boxes = normalizedRows.flatMap((row) => row.boxes);
    const occupied = boxes.length;
    const rowCounts = normalizedRows.map((row) => row.boxes.length);
    const continuity = continuityScore(normalizedRows, model);
    const rightBias = clamp(1 - (features.width - model.rightEdge) / Math.max(1, model.side * 1.1), 0, 1);
    const topBias = clamp(1 - model.topY / Math.max(1, model.side * 0.7), 0, 1);
    const densityPenalty = sparsePenalty(normalizedRows);
    const confidence = clamp((score / Math.max(1, occupied)) * 0.58 + continuity * 0.22 + rightBias * 0.08 + topBias * 0.04 + model.seedScore * 0.08 - densityPenalty * 0.025, 0, 1);
    const modelScore = score + occupied * 0.34 + normalizedRows.length * 1.1 + continuity * 5 + rightBias * 1.3 + topBias * 0.8 + model.seedScore * 8 - densityPenalty;
    return {
        side: occupied ? Math.round(median(boxes.map((box) => box.side))) : model.side,
        detectSide: model.side,
        boxes,
        rows: normalizedRows,
        rawRows: normalizedRows,
        score: modelScore,
        grid: {
            version: "v3",
            confidence: round3(confidence),
            model,
            rowCounts,
        },
    };
}
function scoreSeedRow(features, model, rowIndex, y) {
    const run = findSeedRun(model, y);
    if (!run) {
        return {
            y,
            bottom: y + model.side,
            rightEdge: model.rightEdge,
            pitch: model.pitch,
            boxes: [],
            score: 0,
        };
    }
    const cells = materializeSeedCells(features, model, run, rowIndex, y);
    const score = cells.reduce((sum, cell) => sum + cell.score, 0);
    const sorted = cells.sort((a, b) => a.x - b.x);
    const meanScore = sorted.length ? score / sorted.length : 0;
    return {
        y: run.y,
        bottom: y + model.side,
        rightEdge: model.rightEdge,
        pitch: model.pitch,
        boxes: sorted,
        score: score + Math.sqrt(sorted.length) * 0.52 + meanScore * 0.45,
    };
}
function findSeedRun(model, y) {
    let best = null;
    for (const run of model.seedRuns) {
        const yFit = clamp(1 - Math.abs(run.y - y) / Math.max(1, model.side * 0.32), 0, 1);
        if (yFit <= 0)
            continue;
        const rightFit = edgeAlignmentFit(run.rightEdge, model);
        const pitchFit = run.pitch ? clamp(1 - Math.abs(run.pitch - model.pitch) / Math.max(1, model.side * 0.24), 0, 1) : 0.72;
        const score = yFit * 0.52 + rightFit * 0.25 + pitchFit * 0.13 + clamp(run.count / 10, 0, 1) * 0.1;
        if (!best || score > best.score)
            best = { run, score };
    }
    return best && best.score >= 0.48 ? best.run : null;
}
function materializeSeedCells(features, model, run, rowIndex, expectedY) {
    const cells = run.boxes.map((box, index) => ({
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: model.side,
        height: model.side,
        side: model.side,
        score: clamp(box.score, 0, 1),
        confidence: clamp(box.score, 0, 1),
        row: rowIndex,
        col: index,
        source: "grid-v3:strict-seed",
    }));
    return cells;
}
function fillMissingSeedCells(features, model, cells, rowIndex, expectedY) {
    if (!cells.length)
        return cells;
    if (cells.length < 2)
        return cells;
    const output = [...cells];
    const minSeedX = Math.min(...cells.map((cell) => cell.x));
    let emptyAfterSeedLeft = 0;
    for (let colFromRight = 0; colFromRight < MAX_COLS; colFromRight += 1) {
        const x = Math.round(model.rightEdge - model.side - colFromRight * model.pitch);
        if (x < 0 || x + model.side > features.width)
            continue;
        if (output.some((cell) => Math.abs(cell.x - x) <= model.side * 0.28 && Math.abs(cell.y - expectedY) <= model.side * 0.32))
            continue;
        const cell = bestCellAt(features, x, expectedY, model.side);
        if (cell.score < FILL_THRESHOLD) {
            if (x < minSeedX) {
                emptyAfterSeedLeft += 1;
                if (emptyAfterSeedLeft >= 2)
                    break;
            }
            continue;
        }
        emptyAfterSeedLeft = 0;
        output.push({
            x: cell.x,
            y: cell.y,
            width: model.side,
            height: model.side,
            side: model.side,
            score: cell.score,
            confidence: cell.score,
            row: rowIndex,
            col: colFromRight,
            source: `grid-v3:filled:${round3(cell.borderScore)}/${round3(cell.centerScore)}`,
            synthetic: true,
        });
    }
    return output;
}
function bestCellAt(features, x, y, side) {
    let best = { x, y, score: 0, borderScore: 0, centerScore: 0 };
    const offsets = side <= 36 ? [-2, -1, 0, 1, 2] : [-3, -1, 0, 1, 3];
    const yOffsets = side <= 36 ? [-2, -1, 0, 1, 2] : [-3, -1, 0, 1, 3];
    for (const dy of yOffsets) {
        for (const dx of offsets) {
            const candidate = scoreCellAt(features, x + dx, y + dy, side);
            if (candidate.score > best.score)
                best = candidate;
        }
    }
    return best;
}
function scoreCellAt(features, x, y, side) {
    const clampedX = clamp(Math.round(x), 0, features.width - side);
    const clampedY = clamp(Math.round(y), 0, features.height - side);
    const bevel = bevelForSide(side);
    const lineLength = Math.max(8, side - bevel * 2);
    const top = horizontalLineEvidence(features, clampedX + bevel, clampedY + 1, lineLength).score;
    const bottom = horizontalLineEvidence(features, clampedX + bevel, clampedY + side - 2, lineLength).score;
    const left = verticalLineEvidence(features, clampedX + 1, clampedY + bevel, lineLength).score;
    const right = verticalLineEvidence(features, clampedX + side - 2, clampedY + bevel, lineLength).score;
    const strictTop = strictHorizontalRatio(features, clampedX + bevel, clampedX + side - bevel, clampedY + 1);
    const strictBottom = strictHorizontalRatio(features, clampedX + bevel, clampedX + side - bevel, clampedY + side - 2);
    const strictLeft = strictVerticalRatio(features, clampedX + 1, clampedY + bevel, clampedY + side - bevel);
    const strictRight = strictVerticalRatio(features, clampedX + side - 2, clampedY + bevel, clampedY + side - bevel);
    const strictMean = (strictTop + strictBottom + strictLeft + strictRight) / 4;
    const strictMin = Math.min(strictTop, strictBottom, strictLeft, strictRight);
    const borderMean = (top + bottom + left + right) / 4;
    const borderMin = Math.min(top, bottom, left, right);
    const diagonal = diagonalBevelScore(features, clampedX, clampedY, side, bevel);
    const inner = innerEvidence(features, clampedX, clampedY, side);
    const borderScore = strictMean * 0.52 + strictMin * 0.14 + borderMean * 0.22 + borderMin * 0.06 + diagonal * 0.06;
    const centerScore = inner.edge * 0.62 + inner.dark * 0.24 + inner.contrast * 0.14;
    const score = clamp(borderScore * 0.82 + centerScore * 0.18, 0, 1);
    return {
        x: clampedX,
        y: clampedY,
        score,
        borderScore,
        centerScore,
    };
}
function innerEvidence(features, x, y, side) {
    const stride = features.width + 1;
    const inset = Math.max(5, Math.round(side * 0.22));
    const width = Math.max(4, side - inset * 2);
    const height = Math.max(4, side - inset * 2);
    const edgeMean = rectMean(features.edgeIntegral, stride, x + inset, y + inset, width, height);
    const darkMean = rectMean(features.softDarkIntegral, stride, x + inset, y + inset, width, height);
    const centerLuma = rectMean(features.lumaIntegral, stride, x + inset, y + inset, width, height);
    const outerLuma = rectMean(features.lumaIntegral, stride, x + 2, y + 2, Math.max(4, side - 4), Math.max(4, side - 4));
    return {
        edge: clamp(edgeMean / 54, 0, 1),
        dark: clamp(darkMean, 0, 1),
        contrast: clamp(Math.abs(centerLuma - outerLuma) / 38, 0, 1),
    };
}
function isActiveRow(row, previousActive) {
    if (row.boxes.length >= 2)
        return row.score / Math.max(1, row.boxes.length) >= 0.66;
    if (row.boxes.length === 1) {
        const cell = row.boxes[0];
        return cell.score >= (previousActive ? SINGLETON_THRESHOLD : 0.82);
    }
    return false;
}
function rightEdgeCandidates(features, side, seedRuns) {
    const candidates = rightEdgeMargins(side).map((margin) => features.width - margin).filter((edge) => edge >= side && edge <= features.width + 1);
    const seeded = seedRuns.map((run) => run.rightEdge);
    return uniqueNear([...seeded, ...candidates], Math.max(2, side * 0.12))
        .sort((a, b) => rightEdgePrior(features, b, side) - rightEdgePrior(features, a, side))
        .slice(0, 8);
}
function rightEdgeMargins(side) {
    return [
        ...FIXED_RIGHT_EDGE_MARGINS,
        ...SCALED_RIGHT_EDGE_MARGIN_RATIOS.map((ratio) => Math.round(side * ratio)),
    ];
}
function topYCandidates(features, side, seedRuns) {
    const fixed = [0, 1, 2, 3, 4, 5, 6, 8];
    const seeded = seedRuns
        .filter((run) => run.y <= side * 0.5)
        .sort((a, b) => b.score - a.score || a.y - b.y)
        .map((run) => run.y);
    if (!seeded.length) {
        seeded.push(...seedRuns.slice().sort((a, b) => a.y - b.y).slice(0, 3).map((run) => run.y));
    }
    return uniqueNear([
        ...fixed,
        ...seeded,
    ].filter((y) => y >= 0 && y + side <= features.height), Math.max(1, side * 0.08))
        .sort((a, b) => topYPrior(a) - topYPrior(b))
        .slice(0, 6);
}
function continuityScore(rows, model) {
    if (!rows.length)
        return 0;
    let score = 0;
    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const expectedY = model.topY + i * model.rowStep;
        const yFit = clamp(1 - Math.abs(row.y - expectedY) / Math.max(1, model.side * 0.22), 0, 1);
        const rightMost = row.boxes.length ? Math.max(...row.boxes.map((box) => box.x + box.width)) : 0;
        const rightFit = clamp(1 - Math.abs(rightMost - model.rightEdge) / Math.max(1, model.side * 0.45), 0, 1);
        const rowStrength = clamp(row.boxes.length / Math.max(1, i === 0 ? 8 : 10), 0, 1);
        score += yFit * 0.35 + rightFit * 0.35 + rowStrength * 0.3;
    }
    return score / rows.length;
}
function sparsePenalty(rows) {
    let penalty = 0;
    for (const row of rows) {
        if (row.boxes.length === 1)
            penalty += 0.6;
        if (row.boxes.length >= 2) {
            const xs = row.boxes.map((box) => box.x).sort((a, b) => a - b);
            for (let i = 1; i < xs.length; i += 1) {
                const gap = xs[i] - xs[i - 1];
                if (gap > row.pitch * 1.35)
                    penalty += 0.8;
            }
        }
    }
    return penalty;
}
function modelPrior(features, model) {
    return (model.seedScore * 4 +
        rightEdgePrior(features, model.rightEdge, model.side) * 3 +
        topYPrior(model.topY) * -0.1 -
        Math.abs(model.pitch / model.side - 0.94) * 2 -
        Math.abs(model.rowStep / model.side - 1.1));
}
function rightEdgePrior(features, rightEdge, side) {
    const margin = features.width - rightEdge;
    const known = [3, 22, Math.round(side * 0.68), Math.round(side * 0.74)];
    const nearest = Math.min(...known.map((value) => Math.abs(value - margin)));
    return clamp(1 - nearest / Math.max(1, side * 0.65), 0, 1);
}
function topYPrior(topY) {
    return Math.abs(topY - 2);
}
function normalizeSides(sideCandidates) {
    return [...new Set(sideCandidates.map((side) => Math.round(side)).filter((side) => side >= 24 && side <= 96))].sort((a, b) => a - b);
}
function groupByNear(items, tolerance, key) {
    const groups = [];
    for (const item of items.slice().sort((a, b) => key(a) - key(b))) {
        const value = key(item);
        const group = groups.find((entry) => Math.abs(entry.center - value) <= tolerance);
        if (group) {
            group.items.push(item);
            group.center = median(group.items.map(key));
        }
        else {
            groups.push({ center: value, items: [item] });
        }
    }
    return groups;
}
function diffs(values) {
    const output = [];
    for (let index = 1; index < values.length; index += 1) {
        output.push(values[index] - values[index - 1]);
    }
    return output;
}
function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function uniqueNear(values, tolerance) {
    const output = [];
    for (const value of values.map((item) => Math.round(item)).filter(Number.isFinite).sort((a, b) => a - b)) {
        if (!output.some((existing) => Math.abs(existing - value) <= tolerance))
            output.push(value);
    }
    return output;
}
function emptyLayout() {
    return {
        side: null,
        detectSide: null,
        boxes: [],
        rows: [],
        rawRows: [],
        rejected: [],
        score: 0,
        grid: {
            version: "v3",
            confidence: 0,
            model: null,
            rowCounts: [],
        },
    };
}
function round3(value) {
    return Math.round(value * 1000) / 1000;
}
