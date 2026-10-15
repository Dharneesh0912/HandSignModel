import cv2
import mediapipe as mp
import numpy as np
import os
import csv
import time

# Initialize MediaPipe
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
hands = mp_hands.Hands(min_detection_confidence=0.7, min_tracking_confidence=0.5, max_num_hands=1)

# Settings
DATA_DIR = './data'
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

# List of signs
labels = [chr(i) for i in range(65, 91)] + ['Space', 'Clear'] 
dataset_size = 100  # Total samples per letter
samples_per_set = 25 # 4 sets of 25

# Time settings
PREP_TIME = 3.0      # Seconds to prepare before set starts
CAPTURE_INTERVAL = 0.5 # Seconds between each capture (2 frames per second)

cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

def extract_landmarks(image):
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = hands.process(image_rgb)
    
    if results.multi_hand_landmarks:
        hand_landmarks = results.multi_hand_landmarks[0]
        data_aux = []
        
        x_ = []
        y_ = []
        z_ = []
        
        for lm in hand_landmarks.landmark:
            x_.append(lm.x)
            y_.append(lm.y)
            z_.append(lm.z)
            
        # Normalization
        min_x, min_y, min_z = min(x_), min(y_), min(z_)
        
        for lm in hand_landmarks.landmark:
            data_aux.append(lm.x - min_x)
            data_aux.append(lm.y - min_y)
            data_aux.append(lm.z - min_z)
            
        return data_aux, hand_landmarks
    return None, None

# Main Loop
for label in labels:
    print(f"--- Preparing for letter: {label} ---")
    
    # Create folder for specific letter (optional, but good for organization)
    letter_dir = os.path.join(DATA_DIR, label)
    if not os.path.exists(letter_dir):
        os.makedirs(letter_dir)
        
    counter = 0
    
    # 4 Sets logic
    for set_num in range(4):
        # --- PHASE 1: PREPARATION ---
        # Wait for user to press SPACE
        while True:
            ret, frame = cap.read()
            if not ret: break
            frame = cv2.flip(frame, 1)
            
            cv2.putText(frame, f"NEXT: Letter '{label}' - Set {set_num+1}/4", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 3)
            cv2.putText(frame, "Position hand in frame", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            cv2.putText(frame, "Press SPACE to start capture", (50, 150), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 3)
            
            cv2.imshow('Data Collection', frame)
            key = cv2.waitKey(1)
            if key == 32: # SPACE key
                break
            elif key == ord('q'):
                cap.release()
                cv2.destroyAllWindows()
                exit()

        # --- PHASE 2: COUNTDOWN ---
        start_time = time.time()
        while time.time() - start_time < PREP_TIME:
            ret, frame = cap.read()
            if not ret: break
            frame = cv2.flip(frame, 1)
            
            time_left = int(np.ceil(PREP_TIME - (time.time() - start_time)))
            cv2.putText(frame, f"STARTING IN: {time_left}", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 255), 4)
            cv2.putText(frame, f"Hold '{label}' firm", (50, 180), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            
            # Draw landmarks preview
            landmarks, hand_lms = extract_landmarks(frame)
            if hand_lms:
                mp_drawing.draw_landmarks(frame, hand_lms, mp_hands.HAND_CONNECTIONS)
            
            cv2.imshow('Data Collection', frame)
            cv2.waitKey(1)

        # --- PHASE 3: CONTROLLED CAPTURE ---
        print(f"Capturing Set {set_num+1}...")
        last_capture_time = time.time()
        set_target = (set_num + 1) * samples_per_set
        
        while counter < set_target:
            ret, frame = cap.read()
            if not ret: break
            frame = cv2.flip(frame, 1)
            
            landmarks, hand_lms = extract_landmarks(frame)
            
            # UI
            cv2.putText(frame, f"Letter: {label} | Set: {set_num+1}/4", (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
            cv2.putText(frame, f"Captured: {counter}/{set_target}", (30, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
            
            # Logic: Only capture if hand is detected AND enough time passed
            if landmarks and hand_lms:
                mp_drawing.draw_landmarks(frame, hand_lms, mp_hands.HAND_CONNECTIONS)
                
                # Check time interval (0.5 seconds)
                if time.time() - last_capture_time > CAPTURE_INTERVAL:
                    # SAVE DATA
                    with open(os.path.join(DATA_DIR, 'master_data.csv'), 'a', newline='') as f:
                        writer = csv.writer(f)
                        row = [label] + landmarks
                        writer.writerow(row)
                    
                    counter += 1
                    last_capture_time = time.time()
                    
                    # Visual Cue
                    cv2.rectangle(frame, (0,0), (frame.shape[1], frame.shape[0]), (0, 255, 0), 20)
                    cv2.putText(frame, "CAPTURED!", (frame.shape[1]//2 - 100, frame.shape[0]//2), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 255, 0), 4)
                    cv2.imshow('Data Collection', frame)
                    cv2.waitKey(100) # Freeze briefly to show success
            
            else:
                cv2.putText(frame, "NO HAND DETECTED", (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

            cv2.imshow('Data Collection', frame)
            
            # Allow break
            if cv2.waitKey(1) & 0xFF == ord('q'):
                cap.release()
                cv2.destroyAllWindows()
                exit()
        
        print(f"Set {set_num+1} complete.")
        
        # Prompt to change position for next set
        if set_num < 3:
            print(f"Set {set_num+1} done. Change hand position slightly (Move left/right/rotate).")
            
cap.release()
cv2.destroyAllWindows()
print("Data collection complete.")