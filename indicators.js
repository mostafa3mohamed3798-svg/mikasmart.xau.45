"""
=====================================================================
 أداة تحليل تقني شاملة - Technical Analysis Toolkit
=====================================================================
تجمع هذه الأداة أهم المؤشرات الفنية وتدمجها معاً لإعطاء قرار نهائي:

  1) ATR   (Average True Range)        -> قياس التقلب
  2) RSI   (Relative Strength Index)   -> قياس زخم الشراء/البيع
  3) Support & Resistance              -> مناطق الدعم والمقاومة
  4) Volume Analysis (OBV + Volume MA) -> تأكيد الحركة بالحجم
  5) Moving Averages (SMA/EMA)         -> اتجاه السعر العام
  6) MACD                              -> تأكيد الاتجاه والزخم

في النهاية، دالة `generate_signal()` تدمج كل المؤشرات بنظام تصويت
مرجّح (Weighted Scoring) وتعطي قرار: شراء قوي / شراء / محايد / بيع / بيع قوي

المتطلبات:
    pip install pandas numpy yfinance --break-system-packages

الاستخدام:
    python technical_analysis.py --symbol AAPL --period 6mo --interval 1d
=====================================================================
"""

import argparse
import numpy as np
import pandas as pd


# =====================================================================
# 1) ATR - Average True Range (قياس التقلب)
# =====================================================================
def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)

    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()

    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = true_range.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    return atr


# =====================================================================
# 2) RSI - Relative Strength Index (زخم الشراء/البيع)
# =====================================================================
def calculate_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    delta = df["Close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.fillna(50)  # عند غياب الخسائر تماماً
    return rsi


# =====================================================================
# 3) Support & Resistance (مناطق الدعم والمقاومة)
# =====================================================================
def calculate_support_resistance(df: pd.DataFrame, window: int = 20, tolerance: float = 0.015):
    """
    يحدد القمم والقيعان المحلية (local highs/lows) ثم يجمع المستويات
    القريبة من بعضها ضمن هامش (tolerance) لتكوين "مناطق" دعم ومقاومة
    بدل نقاط مفردة.
    """
    highs = df["High"]
    lows = df["Low"]

    local_max = highs[(highs.shift(1) < highs) & (highs.shift(-1) < highs)]
    local_min = lows[(lows.shift(1) > lows) & (lows.shift(-1) > lows)]

    def cluster_levels(levels: pd.Series, tol: float):
        if levels.empty:
            return []
        values = sorted(levels.dropna().tolist())
        clusters = [[values[0]]]
        for v in values[1:]:
            if abs(v - clusters[-1][-1]) / clusters[-1][-1] <= tol:
                clusters[-1].append(v)
            else:
                clusters.append([v])
        return [round(sum(c) / len(c), 4) for c in clusters]

    resistance_levels = cluster_levels(local_max.tail(window * 3), tolerance)
    support_levels = cluster_levels(local_min.tail(window * 3), tolerance)

    current_price = df["Close"].iloc[-1]
    nearest_support = max([s for s in support_levels if s < current_price], default=None)
    nearest_resistance = min([r for r in resistance_levels if r > current_price], default=None)

    return {
        "support_levels": support_levels,
        "resistance_levels": resistance_levels,
        "nearest_support": nearest_support,
        "nearest_resistance": nearest_resistance,
    }


# =====================================================================
# 4) Volume Analysis: OBV + Volume Moving Average
# =====================================================================
def calculate_volume_indicators(df: pd.DataFrame, ma_period: int = 20) -> pd.DataFrame:
    close = df["Close"]
    volume = df["Volume"]

    direction = np.sign(close.diff()).fillna(0)
    obv = (direction * volume).cumsum()

    volume_ma = volume.rolling(ma_period).mean()

    out = pd.DataFrame({
        "OBV": obv,
        "Volume_MA": volume_ma,
        "Volume_Ratio": volume / volume_ma,   # >1 يعني حجم أعلى من المتوسط
    })
    return out


# =====================================================================
# 5) Moving Averages (SMA / EMA) - اتجاه السعر
# =====================================================================
def calculate_moving_averages(df: pd.DataFrame, fast: int = 20, slow: int = 50) -> pd.DataFrame:
    close = df["Close"]
    return pd.DataFrame({
        f"SMA_{fast}": close.rolling(fast).mean(),
        f"SMA_{slow}": close.rolling(slow).mean(),
        f"EMA_{fast}": close.ewm(span=fast, adjust=False).mean(),
    })


# =====================================================================
# 6) MACD - Moving Average Convergence Divergence
# =====================================================================
def calculate_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    close = df["Close"]
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return pd.DataFrame({
        "MACD": macd_line,
        "MACD_Signal": signal_line,
        "MACD_Hist": histogram,
    })


# =====================================================================
# 7) مؤشرات إضافية لتقوية الفريق: Bollinger, Stochastic, ADX, Fibonacci
# =====================================================================
def calculate_bollinger_bands(df: pd.DataFrame, period: int = 20, std_mult: float = 2.0) -> pd.DataFrame:
    close = df["Close"]
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    bandwidth = (upper - lower) / mid
    percent_b = (close - lower) / (upper - lower)
    return pd.DataFrame({
        "BB_Mid": mid, "BB_Upper": upper, "BB_Lower": lower,
        "BB_Bandwidth": bandwidth, "BB_PercentB": percent_b,
    })


def calculate_stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3) -> pd.DataFrame:
    low_min = df["Low"].rolling(k_period).min()
    high_max = df["High"].rolling(k_period).max()
    percent_k = 100 * (df["Close"] - low_min) / (high_max - low_min)
    percent_d = percent_k.rolling(d_period).mean()
    return pd.DataFrame({"Stoch_K": percent_k, "Stoch_D": percent_d})


def calculate_adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """ADX يقيس *قوة* الاتجاه (وليس اتجاهه)، وهو أساسي لمعرفة هل يمكن
    الوثوق بمؤشرات الاتجاه (MA/MACD) أم أن السوق عرضي (Sideways)."""
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    prev_high = high.shift(1)
    prev_low = low.shift(1)

    up_move = high - prev_high
    down_move = prev_low - low
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    tr = pd.concat([
        high - low, (high - prev_close).abs(), (low - prev_close).abs()
    ], axis=1).max(axis=1)

    atr_s = tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm, index=df.index).ewm(alpha=1 / period, min_periods=period, adjust=False).mean() / atr_s
    minus_di = 100 * pd.Series(minus_dm, index=df.index).ewm(alpha=1 / period, min_periods=period, adjust=False).mean() / atr_s

    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = dx.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    return pd.DataFrame({"Plus_DI": plus_di, "Minus_DI": minus_di, "ADX": adx})


def calculate_fibonacci_levels(df: pd.DataFrame, lookback: int = 60) -> dict:
    """مستويات فيبوناتشي للتصحيح بين أعلى وأدنى سعر خلال آخر lookback شمعة."""
    window = df.tail(lookback)
    swing_high = window["High"].max()
    swing_low = window["Low"].min()
    diff = swing_high - swing_low
    ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
    levels = {f"fib_{r}": round(swing_high - diff * r, 4) for r in ratios}
    levels["swing_high"] = round(swing_high, 4)
    levels["swing_low"] = round(swing_low, 4)
    return levels


def detect_candlestick_pattern(df: pd.DataFrame) -> str:
    """كشف مبسّط لأشهر نماذج الشموع في آخر شمعتين: ابتلاع صعودي/هبوطي أو دوجي."""
    if len(df) < 2:
        return "None"
    o, c, h, l = df["Open"].iloc[-1], df["Close"].iloc[-1], df["High"].iloc[-1], df["Low"].iloc[-1]
    prev_o, prev_c = df["Open"].iloc[-2], df["Close"].iloc[-2]

    body = abs(c - o)
    candle_range = max(h - l, 1e-9)

    if body / candle_range < 0.1:
        return "Doji"
    if prev_c < prev_o and c > o and c > prev_o and o < prev_c:
        return "Bullish_Engulfing"
    if prev_c > prev_o and c < o and c < prev_o and o > prev_c:
        return "Bearish_Engulfing"
    return "None"


# =====================================================================
# 8) الدالة القوية: "فريق" المؤشرات + نظام قرار متقدم بثقة (Confidence)
# =====================================================================
def generate_master_signal(df: pd.DataFrame) -> dict:
    """
    نسخة معزّزة تجعل كل المؤشرات "تعمل كفريق واحد" بدل تصويت مسطّح فقط:

      1. كل مؤشر يعطي صوتاً (-2..+2) مثل السابق.
      2. مؤشر ADX يحدد "حالة السوق": هل هو في اتجاه واضح (Trending) أم
         عرضي (Ranging)؟ هذا يغيّر أوزان المؤشرات الأخرى تلقائياً:
           - سوق متجه (ADX>25): نعزز وزن MACD/Trend/Bollinger breakout
           - سوق عرضي (ADX<20): نعزز وزن RSI/Stochastic/الدعم والمقاومة
         (هذا هو "التعاون بين المؤشرات" الحقيقي بدل جمعها بشكل أعمى)
      3. يُحسب "توافق الفريق" (agreement): كم نسبة المؤشرات تتفق على نفس
         الاتجاه؟ إن كان التوافق منخفضاً يُخفَّض مستوى الثقة بالقرار تلقائياً
         حتى لو كان مجموع النقاط عالياً (تناقض بين المؤشرات = حذر أكبر).
      4. نماذج الشموع وفيبوناتشي تُستخدم كمرشّحات تأكيد إضافية (confirmation
         filters) قرب الدعم/المقاومة، لا كصوت مستقل بوزن ثابت.
      5. الناتج يتضمن: القرار، درجة الثقة، حجم مركز مقترح مبني على ATR
         (لإدارة المخاطر)، ومستويات إيقاف الخسارة/جني الربح المقترحة.
    """
    # --- حساب كل المؤشرات ---
    atr = calculate_atr(df)
    rsi = calculate_rsi(df)
    sr = calculate_support_resistance(df)
    vol = calculate_volume_indicators(df)
    ma = calculate_moving_averages(df)
    macd = calculate_macd(df)
    bb = calculate_bollinger_bands(df)
    stoch = calculate_stochastic(df)
    adx_df = calculate_adx(df)
    fib = calculate_fibonacci_levels(df)
    pattern = detect_candlestick_pattern(df) if "Open" in df.columns else "N/A"

    close = df["Close"].iloc[-1]
    last_rsi = rsi.iloc[-1]
    last_atr = atr.iloc[-1]
    last_macd_hist = macd["MACD_Hist"].iloc[-1]
    prev_macd_hist = macd["MACD_Hist"].iloc[-2]
    last_vol_ratio = vol["Volume_Ratio"].iloc[-1]
    sma_fast, sma_slow = ma["SMA_20"].iloc[-1], ma["SMA_50"].iloc[-1]
    last_adx = adx_df["ADX"].iloc[-1]
    plus_di, minus_di = adx_df["Plus_DI"].iloc[-1], adx_df["Minus_DI"].iloc[-1]
    percent_b = bb["BB_PercentB"].iloc[-1]
    stoch_k, stoch_d = stoch["Stoch_K"].iloc[-1], stoch["Stoch_D"].iloc[-1]

    scores = {}

    # 1) RSI
    if last_rsi >= 70: scores["RSI"] = -2
    elif last_rsi >= 60: scores["RSI"] = 1
    elif last_rsi <= 30: scores["RSI"] = 2
    elif last_rsi <= 40: scores["RSI"] = -1
    else: scores["RSI"] = 0

    # 2) Trend (SMA)
    if sma_fast > sma_slow:
        scores["Trend"] = 1 if close > sma_fast else 0.5
    else:
        scores["Trend"] = -1 if close < sma_fast else -0.5

    # 3) MACD
    if last_macd_hist > 0 and last_macd_hist > prev_macd_hist: scores["MACD"] = 2
    elif last_macd_hist > 0: scores["MACD"] = 1
    elif last_macd_hist < 0 and last_macd_hist < prev_macd_hist: scores["MACD"] = -2
    else: scores["MACD"] = -1

    # 4) Support/Resistance
    sr_score = 0
    if sr["nearest_support"] is not None and (close - sr["nearest_support"]) / close < 0.02:
        sr_score += 1
    if sr["nearest_resistance"] is not None and (sr["nearest_resistance"] - close) / close < 0.02:
        sr_score -= 1
    scores["Support_Resistance"] = sr_score

    # 5) Volume
    price_up = df["Close"].iloc[-1] > df["Close"].iloc[-2]
    scores["Volume"] = (1 if price_up else -1) if last_vol_ratio > 1.3 else 0

    # 6) Bollinger Bands (اختراق أو تشبع)
    if percent_b > 1: scores["Bollinger"] = -1.5   # فوق النطاق العلوي: تشبع/اختراق قوي
    elif percent_b < 0: scores["Bollinger"] = 1.5  # تحت النطاق السفلي
    elif percent_b > 0.8: scores["Bollinger"] = -0.5
    elif percent_b < 0.2: scores["Bollinger"] = 0.5
    else: scores["Bollinger"] = 0

    # 7) Stochastic
    if stoch_k > 80 and stoch_k < stoch_d: scores["Stochastic"] = -1.5
    elif stoch_k < 20 and stoch_k > stoch_d: scores["Stochastic"] = 1.5
    elif stoch_k > stoch_d: scores["Stochastic"] = 0.5
    else: scores["Stochastic"] = -0.5

    # 8) ADX direction (+DI vs -DI) — اتجاه القوة الفعلي
    if last_adx > 20:
        scores["ADX_Direction"] = 1 if plus_di > minus_di else -1
    else:
        scores["ADX_Direction"] = 0

    # --- تحديد حالة السوق وتعديل الأوزان تلقائياً (تعاون المؤشرات) ---
    market_state = "Trending" if last_adx >= 25 else ("Ranging" if last_adx < 20 else "Transition")

    base_weights = {
        "RSI": 1.0, "Trend": 1.2, "MACD": 1.2, "Support_Resistance": 1.0,
        "Volume": 0.7, "Bollinger": 1.0, "Stochastic": 1.0, "ADX_Direction": 1.0,
    }
    weights = dict(base_weights)
    if market_state == "Trending":
        weights["MACD"] *= 1.5
        weights["Trend"] *= 1.5
        weights["ADX_Direction"] *= 1.5
        weights["RSI"] *= 0.6          # RSI أقل موثوقية في الترند القوي
        weights["Stochastic"] *= 0.6
    elif market_state == "Ranging":
        weights["RSI"] *= 1.5
        weights["Stochastic"] *= 1.5
        weights["Support_Resistance"] *= 1.5
        weights["MACD"] *= 0.6
        weights["Trend"] *= 0.6

    # --- مرشّحات تأكيد إضافية من الشموع وفيبوناتشي (لا تُحسب كصوت، بل تُعدّل الثقة) ---
    confirmation_bonus = 0
    notes = []
    if pattern == "Bullish_Engulfing" and scores["Support_Resistance"] >= 0:
        confirmation_bonus += 0.5
        notes.append("نموذج ابتلاع صعودي قرب الدعم يدعم الشراء")
    elif pattern == "Bearish_Engulfing" and scores["Support_Resistance"] <= 0:
        confirmation_bonus -= 0.5
        notes.append("نموذج ابتلاع هبوطي قرب المقاومة يدعم البيع")

    fib_618 = fib.get("fib_0.618")
    if fib_618 and abs(close - fib_618) / close < 0.01:
        notes.append(f"السعر قريب من مستوى فيبوناتشي 61.8% ({fib_618}) — منطقة انعكاس محتملة")

    # --- الجمع المرجّح ---
    weighted_sum = sum(scores[k] * weights[k] for k in scores) + confirmation_bonus
    max_possible = sum(2 * w for w in weights.values())
    normalized = weighted_sum / max_possible * 100

    # --- درجة توافق الفريق (agreement): نسبة الأصوات المتفقة على نفس الجهة ---
    directions = [1 if v > 0 else (-1 if v < 0 else 0) for v in scores.values()]
    nonzero = [d for d in directions if d != 0]
    if nonzero:
        majority_sign = 1 if sum(nonzero) >= 0 else -1
        agreement = sum(1 for d in nonzero if d == majority_sign) / len(nonzero)
    else:
        agreement = 0.5

    confidence = round(agreement * 100, 1)  # % توافق المؤشرات مع القرار

    if normalized >= 40:
        decision = "شراء قوي (Strong Buy)"
    elif normalized >= 15:
        decision = "شراء (Buy)"
    elif normalized <= -40:
        decision = "بيع قوي (Strong Sell)"
    elif normalized <= -15:
        decision = "بيع (Sell)"
    else:
        decision = "محايد / انتظار (Hold)"

    if confidence < 55 and decision != "محايد / انتظار (Hold)":
        decision += " ⚠️ (ثقة منخفضة - تعارض بين المؤشرات، يفضّل الحذر)"

    # --- إدارة المخاطر المقترحة بناءً على ATR ---
    if "شراء" in decision:
        stop_loss = round(close - 1.5 * last_atr, 4)
        take_profit = round(close + 2.5 * last_atr, 4)
    elif "بيع" in decision:
        stop_loss = round(close + 1.5 * last_atr, 4)
        take_profit = round(close - 2.5 * last_atr, 4)
    else:
        stop_loss = take_profit = None

    return {
        "price": round(close, 4),
        "market_state": market_state,
        "ADX": round(last_adx, 2),
        "RSI": round(last_rsi, 2),
        "ATR": round(last_atr, 4),
        "Bollinger_PercentB": round(percent_b, 3),
        "Stochastic_K": round(stoch_k, 2),
        "candlestick_pattern": pattern,
        "nearest_support": sr["nearest_support"],
        "nearest_resistance": sr["nearest_resistance"],
        "fibonacci": fib,
        "scores": scores,
        "weights_used": {k: round(v, 2) for k, v in weights.items()},
        "weighted_score_pct": round(normalized, 2),
        "confidence_pct": confidence,
        "decision": decision,
        "suggested_stop_loss": stop_loss,
        "suggested_take_profit": take_profit,
        "notes": notes,
    }


def print_master_report(symbol: str, result: dict):
    print("=" * 65)
    print(f" التقرير المتقدم (فريق المؤشرات) - {symbol}")
    print("=" * 65)
    print(f"  السعر الحالي           : {result['price']}")
    print(f"  حالة السوق              : {result['market_state']}  (ADX={result['ADX']})")
    print(f"  RSI / Stoch_K           : {result['RSI']} / {result['Stochastic_K']}")
    print(f"  ATR                     : {result['ATR']}")
    print(f"  Bollinger %B            : {result['Bollinger_PercentB']}")
    print(f"  نموذج الشموع            : {result['candlestick_pattern']}")
    print(f"  أقرب دعم / مقاومة       : {result['nearest_support']} / {result['nearest_resistance']}")
    print("-" * 65)
    print("  أصوات المؤشرات (Score) والأوزان المستخدمة:")
    for k, v in result["scores"].items():
        w = result["weights_used"].get(k, 1)
        print(f"     - {k:<20}: score={v:<5} weight={w}")
    if result["notes"]:
        print("-" * 65)
        print("  ملاحظات تأكيد إضافية:")
        for n in result["notes"]:
            print(f"     • {n}")
    print("-" * 65)
    print(f"  الدرجة المرجّحة النهائية : {result['weighted_score_pct']}%")
    print(f"  ثقة توافق الفريق         : {result['confidence_pct']}%")
    print(f"  ✅ القرار النهائي        : {result['decision']}")
    if result["suggested_stop_loss"]:
        print(f"  إيقاف الخسارة المقترح    : {result['suggested_stop_loss']}")
        print(f"  جني الربح المقترح        : {result['suggested_take_profit']}")
    print("=" * 65)


# =====================================================================
# 9) دمج كل المؤشرات في نظام تصويت مرجّح لاتخاذ القرار (نسخة بسيطة سابقة)
# =====================================================================
def generate_signal(df: pd.DataFrame) -> dict:
    """
    يحسب كل المؤشرات، ثم يعطي نقاطاً (score) لكل واحد بين -2 و +2:
      +2  : إشارة شراء قوية جداً
      +1  : إشارة شراء
       0  : محايد
      -1  : إشارة بيع
      -2  : إشارة بيع قوية جداً

    ثم يجمع النقاط بأوزان مختلفة حسب أهمية كل مؤشر، ويحوّل المجموع
    النهائي إلى قرار نصي واضح.
    """
    atr = calculate_atr(df)
    rsi = calculate_rsi(df)
    sr = calculate_support_resistance(df)
    vol = calculate_volume_indicators(df)
    ma = calculate_moving_averages(df)
    macd = calculate_macd(df)

    close = df["Close"].iloc[-1]
    last_rsi = rsi.iloc[-1]
    last_atr = atr.iloc[-1]
    last_macd_hist = macd["MACD_Hist"].iloc
