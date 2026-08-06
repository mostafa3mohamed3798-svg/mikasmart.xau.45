
const price = document.getElementById("price");
const signal = document.querySelector(".signal");
const button = document.querySelector("button");

button.addEventListener("click", () => {
    price.innerText = "جاري التحليل...";
    signal.innerText = "⏳ يتم تحليل السوق...";

    setTimeout(() => {
        price.innerText = "3392.50";
        signal.innerText = "🟢 BUY\nقوة الإشارة: 91%";
    }, 2000);
