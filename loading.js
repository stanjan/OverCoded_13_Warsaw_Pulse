/* Local SVG glyphs avoid exposing remote-font ligature text, including dynamic icons. */
(() => {
  const paths = {
  "palette": "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a3 3 0 0 0 3-3c0-5-4-8-9-8ZM7 9h.01M10 6h.01M15 6h.01M18 9h.01",
  "directions_run": "M15 4h.01M10 9l3-3 4 4h4M13 6l-2 7 4 3-2 5M11 13l-5 5H2M8 8l-3 4",
  "school": "m2 9 10-5 10 5-10 5L2 9Zm4 3v6l6 3 6-3v-6m4-3v9",
  "forum": "M3 3h15v12H8l-5 4V3Zm18 5v14l-4-4h-6",
  "family_restroom": "M7 4h.01M17 4h.01M4 10l3-3 3 3M7 7v14m-3-6h6m4-5 3-3 3 3m-3-3v14m-3-6h6M12 12h.01m0 4v5",
  "wc": "M2 6l2 12 3-8 3 8 2-12m10 2a5 5 0 0 0-8 4 5 5 0 0 0 8 4",
  "elderly": "M15 4h.01M9 11l4-4 3 5 3 1M13 7l-2 8 3 6m-3-6-4 6m12-8v8",
  "park": "m12 2-6 7h3l-5 7h6v6h4v-6h6l-5-7h3L12 2Z",
  "event": "M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4M8 14h3v3H8v-3",
  "family": "M8 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4M16.5 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M5 21v-6l-1-1V9h8v5l-1 1v6m3 0v-4l-1-1v-3h6v3l-1 1v4",
  "location_on": "M12 21s7-7.2 7-13a7 7 0 1 0-14 0c0 5.8 7 13 7 13ZM12 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6",
  "my_location": "M12 2v3m0 14v3M2 12h3m14 0h3M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  "keyboard_arrow_up": "m6 15 6-6 6 6",
  "keyboard_arrow_down": "m6 9 6 6 6-6",
  "arrow_upward": "M12 20V4m-6 6 6-6 6 6",
  "arrow_outward": "M5 19 19 5M5 5h14v14",
  "mic": "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5m-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8",
  "explore": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M16 8l-2 6-6 2 2-6 6-2Z",
  "subway": "M6 17h12V5a3 3 0 0 0-3-3H9a3 3 0 0 0-3 3v12m0-9h12M9 18l-3 4m9-4 3 4M8 21h8M9 13h.01M15 13h.01",
  "local_activity": "M3 5h18v4a3 3 0 0 0 0 6v4H3v-4a3 3 0 0 0 0-6V5m9 0v14",
  "bookmark": "M6 3h12v19l-6-4-6 4V3",
  "favorite": "M12 20s-7.5-4.6-9.2-9.4A4.9 4.9 0 0 1 12 6.4a4.9 4.9 0 0 1 9.2 4.2C19.5 15.4 12 20 12 20Z",
  "payments": "M3 6h18v12H3V6Zm9 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6M6 9h.01M18 15h.01",
  "money_off": "M3 6h18v12H3V6Zm9 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6M2 3l20 18",
  "close": "M6 6l12 12M18 6 6 18",
  "open_in_full": "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  "star": "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z",
  "near_me": "M21 3 3 10.5l7.5 3 3 7.5L21 3Z",
  "map": "m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  "schedule": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v6l4 2",
  "hourglass_top": "M6 2h12M6 22h12M7 2v5l10 10v5M17 2v5L7 17v5",
  "water": "M2 7q3-3 6 0t6 0 6 0m-18 5q3-3 6 0t6 0 6 0m-18 5q3-3 6 0t6 0 6 0",
  "air": "M3 8h12a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h5a3 3 0 1 1-3 3",
  "forest": "m8 3-5 7h3l-4 6h5v5m5-18-4 7h3l-4 6h5v5m0-16 7 8h-3l4 6h-6",
  "pedal_bike": "M10 16a4 4 0 1 1-8 0 4 4 0 0 1 8 0m12 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0M6 16l4-9h6l2 9M8 4h4m3-1h3l2 4M9 9l4 7h5",
  "sports_soccer": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-4-4 3 2 5h4l2-5-4-3m0-5v5M3 10l5 1m2 5-3 4m7-4 3 4m-1-9 5-1",
  "sports_basketball": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3v18M6 5q10 7 0 14M18 5q-10 7 0 14",
  "clear_day": "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  "clear_night": "M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11",
  "cloud": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5",
  "partly_cloudy_day": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M9 2v2M2 5l2 1m13-3-1 2",
  "partly_cloudy_night": "M22 6a4 4 0 0 1-5-5 4 4 0 1 0 5 5Z M5 21H18a4 4 0 0 0 0-8h-1c-.8-2.5-2.5-4-5-4a6 6 0 0 0-6 6H5a3 3 0 0 0 0 6Z",
  "foggy": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M3 20h18M6 23h12",
  "rainy": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M8 19.5l-1 2.2M12 19.5l-1 2.2M16 19.5l-1 2.2",
  "weather_snowy": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M8 19.5v2M7 20.5h2M12 20.5v2M11 21.5h2M16 19.5v2M15 20.5h2",
  "thunderstorm": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M13 16.5l-2.5 3.5h3l-2 3.5",
  "help": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01",
  "cloud_off": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M3 3l18 18",
  "rainy_light": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M9 20l-.7 1.6M15 20l-.7 1.6",
  "rainy_heavy": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M7 19l-1.4 3.2M10.5 19l-1.4 3.2M14 19l-1.4 3.2M17.5 19l-1.4 3.2",
  "weather_mix": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M8 19.5l-1 2.2M12 20v2M11 21h2M16 19.5l-1 2.2",
  "snowing_heavy": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M7 19v2M6 20h2M11.5 19v2M10.5 20h2M16 19v2M15 20h2M9.2 21.6v2M8.2 22.6h2M13.8 21.6v2M12.8 22.6h2",
  "grain": "M5 17a4 4 0 0 1-.5-8A6 6 0 0 1 16 7a5 5 0 1 1 2 10H5M8 20h.01M10.5 21.5h.01M13 20h.01M15.5 21.5h.01"
};
  const selector = '.material-symbols-outlined';
  function paint(node) {
    if (node.firstElementChild?.localName === 'svg') return;
    const name = node.textContent.trim();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name] || paths.help);
    svg.append(path);
    // Preserve an explicit accessible name on the control; glyphs are decorative.
    node.setAttribute('aria-hidden', 'true');
    node.replaceChildren(svg);
  }
  function scan(root) {
    if (root.nodeType === 1 && root.matches(selector)) paint(root);
    root.querySelectorAll?.(selector).forEach(paint);
  }
  scan(document);
  new MutationObserver(records => {
    for (const record of records) {
      const node = record.target.nodeType === 3 ? record.target.parentElement : record.target;
      if (node?.matches?.(selector)) paint(node);
      for (const added of record.addedNodes || []) scan(added);
    }
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
})();
