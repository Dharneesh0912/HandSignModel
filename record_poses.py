# record_poses.py
# ------------------------------------------------------------
# Records hand poses (21 landmarks) for A-Z, Space, Clear.
# Saves to frontend/static/js/poses.json
# ------------------------------------------------------------

import cv2
import mediapipe as mp
import json
import os
import sys
import numpy as np
import time

# ============================================================
# PATHS & SETUP
# ============================================================
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(PROJECT_ROOT, "frontend", "static", "js", "poses.json")
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

LETTERS = [chr(i) for i in range(65, 91)] + ["Space", "Clear"]

# ============================================================
# MEDIAPIPE
# ============================================================
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.5,
)

# ============================================================
# LOAD EXISTING
# ============================================================
poses = {}
if os.path.exists(OUTPUT):
    try:
        with open(OUTPUT, "r") as f:
            poses = json.load(f)
        print(f"Loaded {len(poses)} existing poses.")
    except Exception:
        poses = {}

# ============================================================
# CAMERA — try backends until one works
# ============================================================
def open_camera():
    backends = [
        ("DSHOW", cv2.CAP_DSHOW),
        ("MSMF",  cv2.CAP_MSMF),
        ("ANY",   cv2.CAP_ANY),
    ]
    for name, backend in backends:
        cap = cv2.VideoCapture(0, backend)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                print(f"Camera opened with backend: {name}")
                return cap
            cap.release()
    return None

cap = open_camera()
if cap is None:
    print("ERROR: Could not open any camera.")
    sys.exit(1)

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
cap.set(cv2.CAP_PROP_FPS, 30)

WINDOW = "Record Hand Poses"
cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
cv2.resizeWindow(WINDOW, 960, 720)

# ============================================================
# HELPERS
# ============================================================
def wait_for_key(timeout_ms=1):
    """Return the key code or -1."""
    return cv2.waitKey(timeout_ms) & 0xFF


def draw_centered_text(frame, text, y, scale=1.0, color=(255, 255, 255), thickness=2):
    """Draw text centered horizontally."""
    h, w = frame.shape[:2]
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    x = (w - tw) // 2
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                scale, color, thickness, cv2.LINE_AA)


def draw_overlay(frame, letter, hand_detected, frame_count):
    h, w = frame.shape[:2]

    # Dim top bar
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 130), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

    # Big letter
    draw_centered_text(frame, f"Letter: {letter}", 55,
                       scale=1.4, color=(0, 255, 120), thickness=3)

    # Status
    if hand_detected:
        draw_centered_text(frame, "HAND DETECTED - press SPACE",
                           105, scale=0.8, color=(0, 255, 255), thickness=2)
    else:
        draw_centered_text(frame, "NO HAND - show your hand",
                           105, scale=0.8, color=(0, 100, 255), thickness=2)

    # Bottom bar with instructions
    overlay2 = frame.copy()
    cv2.rectangle(overlay2, (0, h - 60), (w, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay2, 0.55, frame, 0.45, 0, frame)

    draw_centered_text(frame,
                       f"SPACE = capture   |   S = skip   |   Q = quit & save   |   frame {frame_count}",
                       h - 22, scale=0.65, color=(220, 220, 220), thickness=2)

    # Corner brackets
    box = 50
    margin = 90
    for (cx, cy, sx, sy) in [
        (margin,           margin,           1,  1),
        (w - margin,       margin,          -1,  1),
        (margin,           h - margin - 60,  1, -1),
        (w - margin,       h - margin - 60, -1, -1),
    ]:
        cv2.line(frame, (cx, cy), (cx + sx * box, cy), (255, 255, 255), 3)
        cv2.line(frame, (cx, cy), (cx, cy + sy * box), (255, 255, 255), 3)


def extract_landmarks(hand_landmarks):
    """Return list of 21 dicts {x, y, z}."""
    return [{"x": float(lm.x), "y": float(lm.y), "z": float(lm.z)}
            for lm in hand_landmarks.landmark]


# ============================================================
# MAIN LOOP
# ============================================================
print("\n" + "=" * 55)
print("  HAND POSE RECORDER")
print("  SPACE = capture current letter")
print("  S     = skip this letter")
print("  Q     = quit and save")
print("=" * 55)
print("\nFocus the OpenCV window, then press keys.\n")

quit_requested = False

for letter in LETTERS:
    if letter in poses:
        print(f"Already have '{letter}' — skipping. "
              f"(Delete poses.json to redo)")
        continue

    print(f"\n>>> Recording '{letter}'")
    frame_count = 0
    stable_frames = 0          # counts consecutive frames with hand
    required_stable = 3        # need hand visible for 3 frames before allowing capture

    while True:
        ret, frame = cap.read()
        if not ret:
            print("  frame read failed, retrying...")
            time.sleep(0.05)
            continue

        frame_count += 1
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = hands.process(rgb)
        rgb.flags.writeable = True

        hand_landmarks = None
        if results.multi_hand_landmarks:
            hand_landmarks = results.multi_hand_landmarks[0]
            stable_frames += 1
            mp_drawing.draw_landmarks(
                frame, hand_landmarks, mp_hands.HAND_CONNECTIONS,
                mp_drawing.DrawingSpec(color=(0, 255, 120), thickness=2, circle_radius=3),
                mp_drawing.DrawingSpec(color=(255, 255, 255), thickness=2),
            )
        else:
            stable_frames = 0

        # Show wrist coordinates so you know tracking is live
        if hand_landmarks is not None:
            wrist = hand_landmarks.landmark[0]
            cv2.putText(frame,
                        f"wrist: ({wrist.x:.2f}, {wrist.y:.2f})",
                        (20, 160), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (200, 200, 200), 1, cv2.LINE_AA)

        draw_overlay(frame, letter, hand_landmarks is not None, frame_count)

        cv2.imshow(WINDOW, frame)
        key = wait_for_key(1)

        # -------- KEY HANDLING --------
        if key == ord('q') or key == 27:      # Q or ESC
            quit_requested = True
            break

        if key == ord('s'):                   # Skip
            print(f"  skipped '{letter}'")
            break

        if key == 32:                         # SPACE
            if hand_landmarks is None:
                print("  ✗ no hand detected — try again")
                continue
            if stable_frames < required_stable:
                print(f"  ✗ hold steady ({stable_frames}/{required_stable})")
                continue

            poses[letter] = extract_landmarks(hand_landmarks)
            print(f"  ✓ captured '{letter}'  "
                  f"(21 points, frame {frame_count})")

            # Flash green
            flash = frame.copy()
            cv2.rectangle(flash, (0, 0), (frame.shape[1], frame.shape[0]),
                          (0, 255, 0), -1)
            cv2.addWeighted(flash, 0.35, frame, 0.65, 0, frame)
            draw_centered_text(frame, "CAPTURED", frame.shape[0] // 2,
                               scale=2.0, color=(0, 255, 0), thickness=4)
            cv2.imshow(WINDOW, frame)
            cv2.waitKey(250)
            break

    if quit_requested:
        break

# ============================================================
# SAVE
# ============================================================
cap.release()
cv2.destroyAllWindows()

with open(OUTPUT, "w") as f:
    json.dump(poses, f, indent=2)

print("\n" + "=" * 55)
print(f"  Saved {len(poses)} poses to:")
print(f"  {OUTPUT}")
print("=" * 55)

missing = [l for l in LETTERS if l not in poses]
if missing:
    print("\nMissing letters (re-run to capture these):")
    print("  " + ", ".join(missing))
else:
    print("\nAll 28 signs captured. You're ready to use Text-to-Sign!")