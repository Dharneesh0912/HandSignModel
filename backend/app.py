import base64
import numpy as np
import cv2
from text_to_sign import text_to_sign_sequence, get_available_signs, check_sign_coverage
from flask import (
    Flask, render_template, request, jsonify, session, redirect, url_for,
)
from functools import wraps
from config import Config
from database import init_db, get_db
from auth import create_user, verify_user
from predictor import predict_smoothed, extract_features, get_doubt_reason

app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static",
)
app.config.from_object(Config)


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return wrapper


@app.route("/")
def landing():
    return render_template("index.html")


@app.route("/login", methods=["GET", "POST"])
def login_page():
    if request.method == "POST":
        data = request.get_json()
        user = verify_user(data.get("email", ""), data.get("password", ""))
        if user:
            session["user_id"] = user["id"]
            session["user_name"] = user["full_name"]
            return jsonify({"success": True, "redirect": "/dashboard"})
        return jsonify({"success": False, "message": "Invalid email or password."})
    return render_template("login.html")


@app.route("/signup", methods=["GET", "POST"])
def signup_page():
    if request.method == "POST":
        data = request.get_json()
        ok, msg = create_user(
            data.get("full_name", ""),
            data.get("email", ""),
            data.get("password", ""),
        )
        return jsonify({"success": ok, "message": msg})
    return render_template("signup.html")


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html", user_name=session["user_name"])


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("landing"))


@app.route("/api/predict", methods=["POST"])
@login_required
def api_predict():
    payload = request.get_json()
    img_data = payload["image"].split(",")[1]
    img_bytes = base64.b64decode(img_data)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    features, landmarks, handedness, _ = extract_features(frame)

    if features is None:
        return jsonify({"hand": False})

    label, smooth_conf, raw_conf, agreement = predict_smoothed(features)
    reason, fix = get_doubt_reason(label, smooth_conf, landmarks)

    return jsonify({
        "hand": True,
        "label": label,
        "confidence": smooth_conf,       # smoothed (used by frontend for logic)
        "raw_confidence": raw_conf,      # for display/debug
        "agreement": agreement,
        "landmarks": landmarks,
        "handedness": handedness,
        "reason": reason,
        "fix": fix
    })
@app.route("/api/text_to_sign", methods=["POST"])
@login_required
def api_text_to_sign():
    data = request.get_json()
    text = data.get("text", "").strip()

    if not text:
        return jsonify({"success": False, "message": "Empty text."})

    if len(text) > 200:
        return jsonify({"success": False, "message": "Text too long (max 200 characters)."})

    sequence = text_to_sign_sequence(text)
    missing, total, covered = check_sign_coverage(text)

    return jsonify({
        "success": True,
        "text": text,
        "sequence": sequence,
        "stats": {
            "total_chars": len(text),
            "steps": len(sequence),
            "unique_chars": total,
            "covered_chars": covered,
            "missing": missing
        }
    })


@app.route("/api/available_signs")
@login_required
def api_available_signs():
    return jsonify({"signs": get_available_signs()})

@app.route("/api/save_sentence", methods=["POST"])
@login_required
def save_sentence():
    data = request.get_json()
    sentence = data.get("sentence", "").strip()
    if sentence:
        conn = get_db()
        conn.execute(
            "INSERT INTO history (user_id, sentence) VALUES (?, ?)",
            (session["user_id"], sentence),
        )
        conn.commit()
        conn.close()
    return jsonify({"success": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000, threaded=True)
