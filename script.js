const SITE_PASSWORD = "RingBearerRabbie";
const GOOGLE_SHEETS_ENDPOINT = "";

const registryItems = [
  {
    id: "linen",
    title: "Linen Sheets",
    price: "$180",
    store: "Gift",
    url: "https://www.google.com/search?q=luxury+linen+sheets+gift",
    image: "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=700&q=80",
  },
  {
    id: "espresso",
    title: "Espresso Machine Fund",
    price: "$320",
    store: "Amazon",
    url: "https://www.amazon.com/s?k=espresso+machine",
    image: "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=700&q=80",
  },
  {
    id: "vase",
    title: "Big Dramatic Vase",
    price: "$95",
    store: "Gift",
    url: "https://www.google.com/search?q=large+ceramic+statement+vase",
    image: "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?auto=format&fit=crop&w=700&q=80",
  },
  {
    id: "wine",
    title: "Cellar Starter",
    price: "$150",
    store: "Local",
    url: "https://www.google.com/search?q=mornington+peninsula+wine+delivery",
    image: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=700&q=80",
  },
  {
    id: "towels",
    title: "Hotel Towels",
    price: "$110",
    store: "Amazon",
    url: "https://www.amazon.com/s?k=luxury+hotel+towels",
    image: "https://images.unsplash.com/photo-1631889993959-41b4e9c6e3c5?auto=format&fit=crop&w=700&q=80",
  },
  {
    id: "cookbook",
    title: "Dinner Party Cookbooks",
    price: "$70",
    store: "Bookshop",
    url: "https://www.google.com/search?q=dinner+party+cookbooks",
    image: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=700&q=80",
  },
];

const purchased = new Set(JSON.parse(localStorage.getItem("purchasedGifts") || "[]"));

function unlockSite() {
  document.getElementById("gate").classList.add("is-open");
}

function setupGate() {
  const gateForm = document.getElementById("gateForm");
  const guestCode = document.getElementById("guestCode");
  const gateError = document.getElementById("gateError");
  if (!gateForm || !guestCode || !gateError) return;

  if (localStorage.getItem("siteUnlocked") === "true") {
    unlockSite();
  }

  gateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (guestCode.value.trim() === SITE_PASSWORD) {
      localStorage.setItem("siteUnlocked", "true");
      unlockSite();
      return;
    }

    gateError.textContent = "That code is not quite right.";
    guestCode.select();
  });
}

function setupNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const nextState = !nav.classList.contains("is-visible");
    nav.classList.toggle("is-visible", nextState);
    toggle.setAttribute("aria-expanded", String(nextState));
  });

  nav.addEventListener("click", (event) => {
    if (event.target.matches("a")) {
      nav.classList.remove("is-visible");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

function setupRsvp() {
  const form = document.getElementById("rsvpForm");
  const status = document.getElementById("rsvpStatus");
  if (!form || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: formData.get("name"),
      email: formData.get("email"),
      plusOne: formData.get("plusOne"),
      events: formData.getAll("events"),
      dietary: formData.get("dietary"),
      song: formData.get("song"),
      submittedAt: new Date().toISOString(),
    };

    status.textContent = "Sending...";

    try {
      if (GOOGLE_SHEETS_ENDPOINT) {
        await fetch(GOOGLE_SHEETS_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const existing = JSON.parse(localStorage.getItem("rsvps") || "[]");
        existing.push(payload);
        localStorage.setItem("rsvps", JSON.stringify(existing));
      }

      form.reset();
      status.textContent = "RSVP saved. Thank you.";
    } catch {
      status.textContent = "Something went wrong. Please try again.";
    }
  });
}

function renderRegistry() {
  const grid = document.getElementById("registryGrid");
  if (!grid) return;
  const availableItems = registryItems.filter((item) => !purchased.has(item.id));

  if (!availableItems.length) {
    grid.innerHTML = "<p>All placeholder gifts have been claimed on this device.</p>";
    return;
  }

  grid.innerHTML = availableItems
    .map(
      (item) => `
        <article class="registry-card">
          <img src="${item.image}" alt="${item.title}" />
          <p class="eyebrow">${item.store}</p>
          <h3>${item.title}</h3>
          <div class="registry-card__meta">
            <strong>${item.price}</strong>
            <a class="button button--light" href="${item.url}" target="_blank" rel="noreferrer">View</a>
            <button class="button button--light" type="button" data-buy="${item.id}">Bought</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function setupRegistry() {
  const grid = document.getElementById("registryGrid");
  const fakePaypal = document.getElementById("fakePaypal");
  if (!grid || !fakePaypal) return;

  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-buy]");
    if (!button) return;

    purchased.add(button.dataset.buy);
    localStorage.setItem("purchasedGifts", JSON.stringify([...purchased]));
    renderRegistry();
  });

  fakePaypal.addEventListener("click", () => {
    alert("PayPal will be connected later. For now, consider the South American Fund spiritually topped up.");
  });

  renderRegistry();
}

document.addEventListener("DOMContentLoaded", () => {
  setupGate();
  setupNav();
  setupRsvp();
  setupRegistry();

  if (window.lucide) {
    window.lucide.createIcons();
  }
});
