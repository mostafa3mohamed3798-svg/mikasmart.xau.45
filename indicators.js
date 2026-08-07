(function (global) {
"use strict";

// أدوات مساعدة عامة //
function toMillis(t) {
    if (t instanceof Date) return t.getTime();
    if (typeof t === "number") return t < 2e10 ? t * 1000 : t;
    return new Date(t).getTime();
}
function closesOf(data) { return data.map(d => d.close); }
function highsOf(data) { return data.map(d => d.high); }
function lowsOf(data) { return data.map(d => d.low); }
function volumesOf(data) { return data.map(d => d.volume); }

function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = values[0];
    for (let i = 0; i < values.length; i++) {
        prev = i === 0 ? values[0] : (values[i] - prev) * k + prev;
        out[i] = prev;
    }
    return out;
}

function stddev(values, period) {
    const out = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
        const slice = values.slice(i - period + 1, i + 1);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
        out[i] = Math.sqrt(variance);
    }
    return out;
}

function last(arr) { return arr[arr.length - 1]; }
function lastN(arr, n) { return arr[arr.length - n]; }

// 1) قياس التقلب - ATR //
function calculateATR(data, period = 14) {
    const tr = data.map((c, i) => {
        if (i === 0) return c.high - c.low;
        const prevClose = data[i - 1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    });
    return emaWilder(tr, period);
}

function emaWilder(values, period) {
    const out = new Array(values.length).fill(null);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) {
            if (i === period - 2) {
                const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
                prev = seed;
            }
            out[i] = seed;
            continue;
        }
        prev = (values[i] - prev) / period + prev;
        out[i] = prev;
    }
    return out;
}

// 2) RSI //
function calculateRSI(data, period = 14) {
    const closes = closesOf(data);
    const gains = [0], losses = [0];
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        gains.push(Math.max(diff, 0));
        losses.push(Math.max(-diff, 0));
    }
    const avgGain = emaWilder(gains, period);
    const avgLoss = emaWilder(losses, period);
    return closes.map((_, i) => {
        if (avgGain[i] === null || avgLoss[i] === null) return 50;
        if (avgLoss[i] === 0) return 100;
        const rs = avgGain[i] / avgLoss[i];
        return 100 - 100 / (1 + rs);
    });
}

// 3) الدعم والمقاومة //
function calculateSupportResistance(data, window = 20, tolerance = 0.015) {
    const highs = highsOf(data), lows = lowsOf(data);
    const localMax = [], localMin = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) localMax.push(highs[i]);
        if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) localMin.push(lows[i]);
    }
    function cluster(levels, tol) {
        if (!levels.length) return [];
        const sorted = [...levels].sort((a, b) => a - b);
        const clusters = [[sorted[0]]];
        for (let i = 1; i < sorted.length; i++) {
            const cur = clusters[clusters.length - 1];
            if (Math.abs(sorted[i] - cur[cur.length - 1]) / cur[cur.length - 1] <= tol) {
                cur.push(sorted[i]);
            } else {
                clusters.push([sorted[i]]);
            }
        }
        return clusters.map(c => +(c.reduce((a, b) => a + b, 0) / c.length).toFixed(4));
    }
    const recentMax = localMax.slice(-window * 3);
    const recentMin = localMin.slice(-window * 3);
    const resistanceLevels = cluster(recentMax, tolerance);
    const supportLevels = cluster(recentMin, tolerance);
    const price = last(closesOf(data));
    const nearestSupport = supportLevels.filter(s => s < price).sort((a, b) => b - a)[0] ?? null;
    const nearestResistance = resistanceLevels.filter(r => r > price).sort((a, b) => a - b)[0] ?? null;
    return { supportLevels, resistanceLevels, nearestSupport, nearestResistance };
}

})(typeof window !== "undefined" ? window : globalThis);
   (function (global) {
"use strict";

// 9) Smart Money: Swing Points / Market Structure (BOS / CHOCH) //
function findSwingPoints(data, window = 3) {
    const highs = highsOf(data), lows = lowsOf(data);
    const swingHigh = new Array(data.length).fill(false);
    const swingLow = new Array(data.length).fill(false);
    for (let i = window; i < data.length - window; i++) {
        const hSlice = highs.slice(i - window, i + window + 1);
        const lSlice = lows.slice(i - window, i + window + 1);
        if (highs[i] === Math.max(...hSlice) && hSlice.filter(h => h === highs[i]).length === 1) swingHigh[i] = true;
        if (lows[i] === Math.min(...lSlice) && lSlice.filter(l => l === lows[i]).length === 1) swingLow[i] = true;
    }
    return { swingHigh, swingLow };
}

function detectMarketStructure(data, window = 3) {
    const { swingHigh, swingLow } = findSwingPoints(data, window);
    const points = [];
    for (let i = 0; i < data.length; i++) {
        if (swingHigh[i]) points.push({ i, kind: "high", price: data[i].high, time: data[i].time });
        if (swingLow[i]) points.push({ i, kind: "low", price: data[i].low, time: data[i].time });
    }
    points.sort((a, b) => a.i - b.i);
    let lastHigh = null, lastLow = null, trend = null;
    const events = [];
    for (const p of points) {
        if (p.kind === "high") {
            if (lastHigh !== null) {
                if (p.price > lastHigh) {
                    if (trend === "down") {
                        events.push({ i: p.i, time: p.time, type: "CHOCH_Bullish", price: p.price });
                        trend = "up";
                    } else {
                        events.push({ i: p.i, time: p.time, type: "BOS_Bullish", price: p.price });
                        trend = "up";
                    }
                }
            }
            lastHigh = p.price;
        } else {
            if (lastLow !== null) {
                if (p.price < lastLow) {
                    if (trend === "up") {
                        events.push({ i: p.i, time: p.time, type: "CHOCH_Bearish", price: p.price });
                        trend = "down";
                    } else {
                        events.push({ i: p.i, time: p.time, type: "BOS_Bearish", price: p.price });
                        trend = "down";
                    }
                }
            }
            lastLow = p.price;
        }
    }
    return {
        trend,
        lastEvent: events.length ? events[events.length - 1] : null,
        recentEvents: events.slice(-5),
        lastSwingHigh: lastHigh,
        lastSwingLow: lastLow,
    };
}

// 10) Order Blocks & Fair Value Gaps //
function detectOrderBlocks(data, structureEvents, atrArr) {
    const volumes = volumesOf(data);
    const blocks = [];
    for (const ev of structureEvents) {
        const breakCandle = data[ev.i];
        const breakRange = breakCandle.high - breakCandle.low;
        const atrAtBreak = atrArr && atrArr[ev.i] ? atrArr[ev.i] : null;
        const localVols = volumes.slice(Math.max(0, ev.i - 20), ev.i);
        const localVolAvg = localVols.length ? localVols.reduce((a, b) => a + b, 0) / localVols.length : 0;
        const strongBreak = atrAtBreak ? breakRange >= 1.3 * atrAtBreak : true;
        const volumeConfirmed = localVolAvg ? breakCandle.volume >= localVolAvg : true;
        if (!strongBreak || !volumeConfirmed) continue;

        const start = Math.max(0, ev.i - 10);
        const segment = data.slice(start, ev.i + 1);
        const isBullish = ev.type.includes("Bullish");
        const opposite = isBullish ? segment.filter(c => c.close < c.open) : segment.filter(c => c.close > c.open);
        if (!opposite.length) continue;
        const c = opposite[opposite.length - 1];
        let retested = false, mitigated = false, mitigatedAt = null;
        for (let j = ev.i + 1; j < data.length; j++) {
            const bar = data[j];
            const touchesZone = bar.low <= c.high && bar.high >= c.low;
            if (touchesZone) {
                retested = true;
                const invalidated = isBullish ? bar.close < c.low : bar.close > c.high;
                if (invalidated) { mitigated = true; mitigatedAt = bar.time; break; }
            }
        }
        blocks.push({
            type: isBullish ? "Bullish_OB" : "Bearish_OB",
            time: c.time, top: +c.high.toFixed(4), bottom: +c.low.toFixed(4),
            relatedEvent: ev.type,
            breakStrengthATR: atrAtBreak ? +(breakRange / atrAtBreak).toFixed(2) : null,
            volumeConfirmed, retested, mitigated, mitigatedAt,
        });
    }
    return blocks.slice(-10);
}

// 14) الدالة الاحترافية الموحدة //
function generateProSignal(data, htfData = null, newsTimes = [], structureWindow = 3) {
    const price = last(closesOf(data));
    const nowTime = last(data).time;
    
    const atrArr = calculateATR(data);
    const atr = last(atrArr.filter(v => v !== null));
    const rsiArr = calculateRSI(data);
    const rsi = last(rsiArr);
    const structure = detectMarketStructure(data, structureWindow);
    const ob = detectOrderBlocks(data, structure.recentEvents, atrArr).filter(z => !z.mitigated);

    return {
        price: +price.toFixed(4),
        marketStructureTrend: structure.trend,
        lastStructureEvent: structure.lastEvent,
        orderBlocks: ob.slice(-3),
        atr: +atr.toFixed(4),
        rsi: +rsi.toFixed(2),
    };
}

})(typeof window !== "undefined" ? window : globalThis);

