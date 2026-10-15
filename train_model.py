import pandas as pd
import numpy as np
import os
import joblib
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, VotingClassifier, HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import matplotlib.pyplot as plt
import seaborn as sns

# ==========================================
# 1. LOAD AND PREPARE DATA
# ==========================================
data_path = './data/master_data.csv'
if not os.path.exists(data_path):
    print("Error: No data found at ./data/master_data.csv. Run collect_data.py first.")
    exit()

print("Loading data...")
df = pd.read_csv(data_path, header=None)

# --- FIX: Convert to pure NumPy arrays to avoid pandas 3.0 slicing bug ---
# We explicitly use .to_numpy() and force dtype to float32
X = df.iloc[:, 1:].to_numpy(dtype=np.float32)
y = df.iloc[:, 0].to_numpy(dtype=str)

print(f"Total samples collected: {X.shape[0]}")
print(f"Total features per sample: {X.shape[1]} (21 landmarks * 3 axes)")
print(f"Unique classes: {len(np.unique(y))}")

# Split Data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# ==========================================
# 2. BUILD THE ULTIMATE ENSEMBLE MODEL
# ==========================================
print("\nBuilding the Ultimate Ensemble Model...")

rf = RandomForestClassifier(
    n_estimators=200, 
    max_depth=20, 
    random_state=42, 
    n_jobs=-1
)

et = ExtraTreesClassifier(
    n_estimators=200, 
    max_depth=20, 
    random_state=42, 
    n_jobs=-1
)

gb = HistGradientBoostingClassifier(
    max_iter=200, 
    learning_rate=0.1, 
    random_state=42
)

voting_clf = VotingClassifier(
    estimators=[
        ('rf', rf),
        ('et', et),
        ('gb', gb)
    ],
    voting='soft',
    n_jobs=-1
)

# ==========================================
# 3. TRAIN THE MODEL
# ==========================================
print("Training models... (This might take a minute or two)")
voting_clf.fit(X_train, y_train)

# ==========================================
# 4. EVALUATE ACCURACY
# ==========================================
print("\nEvaluating model on unseen test data...")
y_pred = voting_clf.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)

print(f"\n==========================================")
print(f"FINAL MODEL ACCURACY: {accuracy * 100:.2f}%")
print(f"==========================================\n")

print("Detailed Classification Report:")
print(classification_report(y_test, y_pred))

# ==========================================
# 5. SAVE THE MODEL
# ==========================================
if not os.path.exists('./model'):
    os.makedirs('./model')

model_path = './model/sign_model.pkl'
joblib.dump(voting_clf, model_path)
print(f"Model successfully saved to {model_path}")

# ==========================================
# 6. CONFUSION MATRIX
# ==========================================
try:
    plt.figure(figsize=(15, 12))
    cm = confusion_matrix(y_test, y_pred, labels=np.unique(y))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=np.unique(y), yticklabels=np.unique(y))
    plt.title('Confusion Matrix - Where is the model making mistakes?')
    plt.ylabel('True Letter')
    plt.xlabel('Predicted Letter')
    
    plt.savefig('./model/confusion_matrix.png')
    print("Confusion matrix saved to ./model/confusion_matrix.png")
    print("Open this image to see exactly which letters are being confused.")
except Exception as e:
    print(f"Could not generate confusion matrix plot: {e}")