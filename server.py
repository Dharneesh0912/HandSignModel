import cv2
import mediapipe as mp
import numpy as np
import joblib
import time
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import base64

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Load Model
model = joblib.load('./model/sign_model.pkl')

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
hands = mp_hands.Hands(min_detection_confidence=0.7, min_tracking_confidence=0.5, max_num_hands=1)

cap = cv2.VideoCapture(0)

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
            
        # Return data + raw landmarks for drawing + hand center X
        hand_center_x = np.mean(x_)
        return data_aux, hand_landmarks, hand_center_x
    return None, None, None

@socketio.on('connect')
def test_connect():
    print('Client connected')

def generate_frames():
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        frame = cv2.flip(frame, 1)
        
        landmarks, hand_lms, hand_x = extract_landmarks(frame)
        
        predicted_char = ""
        confidence = 0.0
        is_doubtful = False
        hand_data = None
        
        if landmarks:
            prediction = model.predict([landmarks])[0]
            predicted_char = prediction
            
            try:
                proba = model.predict_proba([landmarks])[0]
                confidence = np.max(proba)
            except:
                confidence = 1.0
            
            # Doubt Logic: If confidence < 70%
            if confidence < 0.70:
                is_doubtful = True
                
            # Extract landmark points for frontend drawing
            hand_data = []
            for lm in hand_lms.landmark:
                hand_data.append({'x': lm.x, 'y': lm.y, 'z': lm.z})
        
        # Encode frame (optional, we can rely on frontend canvas)
        # For simplicity, we send the raw data. The frontend will draw.
        
        data = {
            'prediction': predicted_char,
            'confidence': float(confidence),
            'is_doubtful': is_doubtful,
            'hand_x': float(hand_x) if hand_x else 0.5,
            'landmarks': hand_data
        }
        
        socketio.emit('prediction', data)
        socketio.sleep(0.05) # 20 FPS

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    socketio.start_background_task(generate_frames)
    socketio.run(app, host='0.0.0.0', port=5000)