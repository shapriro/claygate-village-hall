// Multi-image gallery carousel for room cards
document.addEventListener("DOMContentLoaded", () => {
  initRoomGalleries();
});

function initRoomGalleries() {
  const galleries = document.querySelectorAll(".room-gallery");

  galleries.forEach(gallery => {
    const images = gallery.querySelectorAll("img");
    const counter = gallery.querySelector(".photo-counter");
    const dotsContainer = gallery.querySelector(".gallery-dots");
    const prevBtn = gallery.querySelector(".gallery-prev");
    const nextBtn = gallery.querySelector(".gallery-next");

    if (images.length <= 1) return;

    let currentIndex = 0;

    // Create interactive navigation dots
    if (dotsContainer) {
      dotsContainer.innerHTML = "";
      images.forEach((_, idx) => {
        const dot = document.createElement("div");
        dot.className = `gallery-dot ${idx === 0 ? "active" : ""}`;
        dot.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          goToSlide(idx);
        });
        dotsContainer.appendChild(dot);
      });
    }

    function update() {
      images.forEach((img, idx) => {
        img.classList.toggle("active", idx === currentIndex);
      });
      if (dotsContainer) {
        dotsContainer.querySelectorAll(".gallery-dot").forEach((d, idx) => {
          d.classList.toggle("active", idx === currentIndex);
        });
      }
      if (counter) counter.textContent = `${currentIndex + 1} / ${images.length}`;
    }

    function goToSlide(idx) {
      currentIndex = idx;
      update();
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + images.length) % images.length;
        update();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % images.length;
        update();
      });
    }

    // Allow clicking the photo itself to advance
    gallery.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "img") {
        currentIndex = (currentIndex + 1) % images.length;
        update();
      }
    });

    update();
  });
}
