"""
Text-to-Sign conversion module.
Maps text characters to sign image filenames.
"""

import os
import re

# Base directory for sign images
SIGNS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend", "static", "img", "signs"
)

# Supported image extensions (first match wins)
IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]


def get_sign_image_path(character):
    """
    Return the relative static path for a character's sign image.
    Returns None if no image is found.
    """
    if character == " ":
        character = "Space"
    elif character.lower() == "clear":
        character = "Clear"
    else:
        character = character.upper()

    for ext in IMAGE_EXTENSIONS:
        filename = f"{character}{ext}"
        full_path = os.path.join(SIGNS_DIR, filename)
        if os.path.exists(full_path):
            return f"img/signs/{filename}"
    return None


def text_to_sign_sequence(text):
    """
    Convert a text string into a list of sign steps.

    Each step is a dict:
      {
        "char": "H",
        "display": "H",
        "image": "img/signs/H.png" or None,
        "type": "letter" | "space" | "clear"
      }
    """
    sequence = []
    seen_chars = set()

    for char in text:
        if char == " ":
            step = {
                "char": " ",
                "display": "SPACE",
                "image": get_sign_image_path("Space"),
                "type": "space"
            }
        elif char == "\n":
            continue
        else:
            upper = char.upper()
            step = {
                "char": upper,
                "display": upper,
                "image": get_sign_image_path(upper),
                "type": "letter"
            }
        sequence.append(step)
        seen_chars.add(step["char"])

    # Deduplicate consecutive identical letters (optional)
    # Uncomment if you want to compress repeats like "LL" -> "L"
    # sequence = [s for i, s in enumerate(sequence)
    #             if i == 0 or s["char"] != sequence[i-1]["char"]]

    return sequence


def get_available_signs():
    """Return a list of sign characters that have images available."""
    available = []
    if not os.path.isdir(SIGNS_DIR):
        return available

    for filename in os.listdir(SIGNS_DIR):
        name, ext = os.path.splitext(filename)
        if ext.lower() in IMAGE_EXTENSIONS:
            available.append(name)
    return sorted(available)


def check_sign_coverage(text):
    """
    Check which characters in the text have missing sign images.
    Returns (missing_letters, total_unique, covered_unique).
    """
    unique = set()
    for char in text:
        if char == " ":
            unique.add("Space")
        elif char.isalpha():
            unique.add(char.upper())

    available = set(get_available_signs())
    missing = sorted(unique - available)
    covered = unique & available

    return missing, len(unique), len(covered)