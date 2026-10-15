const form = document.getElementById("loginForm") || document.getElementById("signupForm");
const msg = document.getElementById("msg");

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const endpoint = form.id === "loginForm" ? "/login" : "/signup";
    const payload = Object.fromEntries(new FormData(form));

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      msg.textContent = data.message || "Done!";
      msg.className = "msg " + (data.success ? "success" : "error");

      if (data.success) {
        if (data.redirect) window.location.href = data.redirect;
        else setTimeout(() => (window.location.href = "/login"), 900);
      }
    } catch (err) {
      msg.textContent = "Network error. Try again.";
      msg.className = "msg error";
    }
  });
}