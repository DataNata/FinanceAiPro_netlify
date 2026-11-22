// Ошибку входа передаёт /api/login через параметры адреса (отдельный файл — политика безопасности запрещает встроенные скрипты).
(function () {
  var q = new URLSearchParams(location.search), box = document.getElementById("loginError"), msg = "";
  if (q.get("error") === "wrong") msg = "Неверный код доступа";
  if (q.get("error") === "locked") {
    var until = new Date(Number(q.get("until")));
    msg = "Слишком много неверных попыток. Вход заблокирован" +
      (isNaN(until) ? " на 15 минут" : " до " + until.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
  }
  if (msg) { box.textContent = msg; box.hidden = false; }
})();
