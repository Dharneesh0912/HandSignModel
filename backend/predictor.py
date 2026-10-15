import joblib
import numpy as np
import mediapipe as mp
import cv2
import time
from config import Config

model = joblib.load(Config.MODEL_PATH)

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

hands = mp_hands.Hands(
    min_detection_confidence=0.7,
    min_tracking_confidence=0.5,
    max_num_hands=1
)

# ============================================================
# STABILITY TRACKER
# Keeps last N predictions to compute a smoothed confidence
# ============================================================
class PredictionSmoother:
    def __init__(self, window=6):
        self.window = window
        self.history = []   # list of (label, confidence, timestamp)
        self.last_stable_label = None
        self.last_stable_since = 0
        self.locked = False

    def push(self, label, confidence):
        now = time.time()
        self.history.append((label, confidence, now))
        # Keep only recent
        self.history = [h for h in self.history if now - h[2] < 1.5]
        if len(self.history) > self.window:
            self.history = self.history[-self.window:]

    def get_smoothed(self):
        """Return (best_label, smoothed_confidence, agreement_ratio)"""
        if not self.history:
            return None, 0.0, 0.0

        # Count label votes
        from collections import Counter
        labels = [h[0] for h in self.history]
        counts = Counter(labels)
        best_label, votes = counts.most_common(1)[0]
        agreement = votes / len(self.history)

        # Average confidence for the winning label
        confs = [h[1] for h in self.history if h[0] == best_label]
        avg_conf = sum(confs) / len(confs)

        # Boost confidence by agreement
        # If 5/6 frames agree → boost significantly
        boosted = avg_conf * (0.6 + 0.4 * agreement)
        # If agreement is 100%, add extra
        if agreement >= 0.8:
            boosted = min(1.0, boosted + 0.1)

        return best_label, boosted, agreement

    def reset(self):
        self.history = []


smoother = PredictionSmoother(window=6)


def extract_features(frame):
    frame = cv2.flip(frame, 1)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = hands.process(rgb)

    if not results.multi_hand_landmarks:
        smoother.reset()
        return None, None, None, frame

    lm = results.multi_hand_landmarks[0]
    handedness = results.multi_handedness[0].classification[0].label

    x_ = [p.x for p in lm.landmark]
    y_ = [p.y for p in lm.landmark]
    z_ = [p.z for p in lm.landmark]
    mn_x, mn_y, mn_z = min(x_), min(y_), min(z_)

    data = []
    for p in lm.landmark:
        data.extend([p.x - mn_x, p.y - mn_y, p.z - mn_z])

    landmarks = [{"x": p.x, "y": p.y, "z": p.z} for p in lm.landmark]

    return data, landmarks, handedness, frame


def predict(features):
    """Raw model prediction (still used for the smoother)."""
    if features is None:
        return None, 0.0
    pred = model.predict([features])[0]
    conf = float(np.max(model.predict_proba([features])[0]))
    return pred, conf


def predict_smoothed(features):
    """
    Full pipeline with temporal smoothing.
    Returns (label, smoothed_confidence, raw_confidence, agreement)
    """
    if features is None:
        return None, 0.0, 0.0, 0.0

    raw_label, raw_conf = predict(features)
    smoother.push(raw_label, raw_conf)
    smooth_label, smooth_conf, agreement = smoother.get_smoothed()

    return smooth_label, smooth_conf, raw_conf, agreement


def get_doubt_reason(label, conf, landmarks):
    if landmarks is None:
        return "Show your hand clearly in the frame", "Bring your hand into view"

    xs = [p["x"] for p in landmarks]
    ys = [p["y"] for p in landmarks]
    spread = max(xs) - min(xs) + (max(ys) - min(ys))
    center_x = sum(xs) / len(xs)
    center_y = sum(ys) / len(ys)

    if conf < 0.45:
        if spread < 0.25:
            return "Hand looks too small", "Move your hand closer to the camera"
        if center_x < 0.25 or center_x > 0.75 or center_y < 0.20 or center_y > 0.85:
            return "Hand is near the edge", "Move your hand to the center"
        return "Not enough certainty", "Hold the sign steady for a moment"

    if conf < 0.70:
        return "Almost there — hold steady", "Keep your hand still for a moment"

    return None, None