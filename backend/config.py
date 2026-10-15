import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

class Config:
    SECRET_KEY = "change-this-to-a-long-random-string-in-production"
    DATABASE = os.path.join(BASE_DIR, "users.db")
    MODEL_PATH = os.path.join(BASE_DIR, "model", "sign_model.pkl")
    CONFIDENCE_THRESHOLD = 0.70
    HOLD_DURATION = 1.5  # seconds