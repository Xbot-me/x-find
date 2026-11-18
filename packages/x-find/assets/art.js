/* Original art for the x-find snow scene: penguin, snowman, igloo. Pure SVG strings, no outlines, soft shading. */
globalThis.ART = (() => {
  const defs = () => `
  <defs>
    <linearGradient id="pgBody" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#2E3B5E"/><stop offset="0.55" stop-color="#18213A"/><stop offset="1" stop-color="#0C1222"/>
    </linearGradient>
    <radialGradient id="pgBelly" cx="0.42" cy="0.32" r="0.8">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.7" stop-color="#F1F5FB"/><stop offset="1" stop-color="#C9D7EA"/>
    </radialGradient>
    <linearGradient id="pgBeak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFB547"/><stop offset="1" stop-color="#F07A1A"/>
    </linearGradient>
    <linearGradient id="pgFoot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFA23A"/><stop offset="1" stop-color="#E0661A"/>
    </linearGradient>
    <linearGradient id="pgScarf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF6A4A"/><stop offset="1" stop-color="#D93A2B"/>
    </linearGradient>
    <radialGradient id="snowBall" cx="0.36" cy="0.3" r="0.78">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.62" stop-color="#EEF4FB"/><stop offset="1" stop-color="#B8CBE3"/>
    </radialGradient>
    <linearGradient id="carrot" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#F28C28"/><stop offset="1" stop-color="#FFB347"/>
    </linearGradient>
    <radialGradient id="brick" cx="0.35" cy="0.25" r="0.9">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D3E1F1"/>
    </radialGradient>
    <radialGradient id="doorGlow" cx="0.5" cy="0.85" r="0.75">
      <stop offset="0" stop-color="#FFD58A"/><stop offset="0.45" stop-color="#F2A54A"/><stop offset="1" stop-color="#5B3A2A"/>
    </radialGradient>
    <radialGradient id="spill" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFC874" stop-opacity="0.55"/><stop offset="1" stop-color="#FFC874" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="contact" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#3B5578" stop-opacity="0.38"/><stop offset="1" stop-color="#3B5578" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="iglooBase" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#C9D8EC" stop-opacity="0.55"/><stop offset="1" stop-color="#8FA6C8" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B9774A"/><stop offset="1" stop-color="#7A4A2C"/>
    </linearGradient>
  </defs>`;

  /** The penguin. Origin at the feet. Groups: body, eyes (blink), flippers (wave/push). */
  const penguin = ({ pose = 'idle' } = {}) => `
  <g class="penguin pose-${pose}">
    <ellipse cx="0" cy="2" rx="78" ry="12" fill="url(#contact)"/>
    <g class="pg-body">
      <g class="pg-flipper pg-flipper-l">
        <path d="M-58 -128 C -86 -112 -98 -78 -92 -52 C -90 -44 -82 -46 -80 -54 C -74 -78 -62 -100 -50 -112 Z" fill="#141C31"/>
      </g>
      <g class="pg-flipper pg-flipper-r">
        <path d="M58 -128 C 86 -112 98 -78 92 -52 C 90 -44 82 -46 80 -54 C 74 -78 62 -100 50 -112 Z" fill="#141C31"/>
      </g>
      <path d="M0 -214 C 52 -214 74 -168 74 -120 C 74 -60 62 -4 0 -2 C -62 -4 -74 -60 -74 -120 C -74 -168 -52 -214 0 -214 Z" fill="url(#pgBody)"/>
      <path d="M52 -186 C 70 -160 76 -110 70 -60" fill="none" stroke="#7F93C4" stroke-width="3" stroke-linecap="round" opacity="0.35"/>
      <path d="M-50 -176 C -40 -200 -18 -208 2 -208" fill="none" stroke="#5D6F99" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
      <path d="M0 -176 C 22 -176 42 -160 48 -132 C 54 -90 50 -26 0 -12 C -50 -26 -54 -90 -48 -132 C -42 -160 -22 -176 0 -176 Z" fill="url(#pgBelly)"/>
      <ellipse cx="-24" cy="-162" rx="20" ry="22" fill="url(#pgBelly)"/>
      <ellipse cx="24" cy="-162" rx="20" ry="22" fill="url(#pgBelly)"/>
      <g class="pg-eyes">
        <ellipse cx="-21" cy="-160" rx="9" ry="11" fill="#0E1528"/>
        <ellipse cx="21" cy="-160" rx="9" ry="11" fill="#0E1528"/>
        <circle cx="-18" cy="-164" r="3.6" fill="#FFFFFF"/>
        <circle cx="24" cy="-164" r="3.6" fill="#FFFFFF"/>
        <circle cx="-24" cy="-156" r="1.6" fill="#FFFFFF" opacity="0.7"/>
        <circle cx="18" cy="-156" r="1.6" fill="#FFFFFF" opacity="0.7"/>
      </g>
      <ellipse cx="-36" cy="-140" rx="8" ry="5" fill="#FF8FA0" opacity="0.45"/>
      <ellipse cx="36" cy="-140" rx="8" ry="5" fill="#FF8FA0" opacity="0.45"/>
      <path d="M-11 -146 C -6 -152 6 -152 11 -146 C 8 -134 3 -130 0 -130 C -3 -130 -8 -134 -11 -146 Z" fill="url(#pgBeak)"/>
      <path d="M-8 -145 C -3 -148 3 -148 8 -145" fill="none" stroke="#FFE2A8" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>
      <g class="pg-scarf">
        <path d="M-56 -120 C -30 -104 30 -104 56 -120 L 58 -104 C 30 -88 -30 -88 -58 -104 Z" fill="url(#pgScarf)"/>
        <path d="M30 -100 C 38 -84 44 -66 42 -52 L 26 -54 C 28 -66 24 -82 18 -96 Z" fill="#D93A2B"/>
        <path d="M27 -60 L 43 -58 M28 -68 L 42 -66" stroke="#FFB4A0" stroke-width="2" opacity="0.7"/>
        <path d="M-50 -112 C -24 -100 24 -100 50 -112" fill="none" stroke="#FFB4A0" stroke-width="2" opacity="0.5"/>
      </g>
    </g>
    <g class="pg-feet">
      <path d="M-34 -8 C -50 -8 -56 4 -42 7 C -30 10 -16 8 -12 2 C -10 -4 -20 -9 -34 -8 Z" fill="url(#pgFoot)"/>
      <path d="M34 -8 C 50 -8 56 4 42 7 C 30 10 16 8 12 2 C 10 -4 20 -9 34 -8 Z" fill="url(#pgFoot)"/>
    </g>
  </g>`;

  /** A shaded snowball centred at (cx, cy). */
  const ball = (cx, cy, r, cls = '') =>
    `<g class="${cls}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#snowBall)"/>
     <path d="M${cx - r * 0.82} ${cy + r * 0.32} A ${r} ${r} 0 0 0 ${cx + r * 0.86} ${cy + r * 0.26} A ${r * 1.15} ${r * 0.85} 0 0 1 ${cx - r * 0.82} ${cy + r * 0.32} Z" fill="#AFC3DD" opacity="0.55"/>
     <ellipse cx="${cx - r * 0.38}" cy="${cy - r * 0.42}" rx="${r * 0.22}" ry="${r * 0.12}" fill="#FFFFFF" opacity="0.9" transform="rotate(-30 ${cx - r * 0.38} ${cy - r * 0.42})"/></g>`;

  /** The snowman by stage (0 = a ball being rolled, 4 = finished). Origin at ground centre. */
  const snowman = (stage, buttons = 0) => {
    if (stage === 0)
      return `<ellipse cx="0" cy="2" rx="40" ry="8" fill="url(#contact)"/>${ball(0, -30, 30, 'sm-roll')}`;
    let s = `<ellipse cx="0" cy="4" rx="96" ry="14" fill="url(#contact)"/>${ball(0, -66, 70, 'sm-base')}`;
    if (stage >= 2) {
      s += ball(0, -166, 52, 'sm-body');
      for (let i = 0; i < Math.min(buttons, 4); i++)
        s += `<circle class="sm-button" cx="0" cy="${-184 + i * 18}" r="5.5" fill="#1B2236"/><circle cx="-1.5" cy="${-186 + i * 18}" r="1.6" fill="#5A6788"/>`;
    }
    if (stage >= 3) {
      s += ball(0, -246, 38, 'sm-head');
      s += `<g class="sm-face"><ellipse cx="-13" cy="-254" rx="4.6" ry="5.4" fill="#141A2C"/><ellipse cx="13" cy="-254" rx="4.6" ry="5.4" fill="#141A2C"/>
      <circle cx="-11.5" cy="-256" r="1.4" fill="#fff"/><circle cx="14.5" cy="-256" r="1.4" fill="#fff"/>
      <path d="M0 -244 C 14 -246 34 -242 40 -238 C 30 -236 12 -236 0 -238 Z" fill="url(#carrot)"/>
      ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${-14 + i * 7}" cy="${-228 + Math.sin((i / 4) * Math.PI) * 5}" r="2.5" fill="#141A2C"/>`).join('')}</g>`;
    }
    if (stage >= 4) {
      s += `<g class="sm-extras">
        <path d="M-48 -160 L-112 -214 M-90 -196 L-104 -222 M-96 -200 L-122 -206" stroke="#5B3A22" stroke-width="5" stroke-linecap="round" fill="none"/>
        <path d="M48 -160 L114 -208 M92 -192 L112 -222" stroke="#5B3A22" stroke-width="5" stroke-linecap="round" fill="none"/>
        <path d="M-44 -212 C -20 -198 20 -198 44 -212 L 46 -196 C 20 -182 -20 -182 -46 -196 Z" fill="url(#pgScarf)"/>
        <path d="M22 -196 C 30 -178 34 -160 30 -146 L 16 -150 C 20 -162 16 -178 10 -192 Z" fill="#D93A2B"/>
        <path d="M-38 -278 L 38 -278 L 32 -326 L -32 -326 Z" fill="#141A2C"/>
        <rect x="-54" y="-282" width="108" height="10" rx="5" fill="#141A2C"/>
        <rect x="-33" y="-296" width="66" height="10" fill="#E8553D"/>
        <path d="M-28 -322 L -24 -284" stroke="#3A4566" stroke-width="3" opacity="0.6"/></g>`;
    }
    return s;
  };

  /** Igloo: one brick per wanted page; placed bricks are indexed, dashed ones are still to come. */
  const igloo = (total, placed, newOnes = 0) => {
    const R = 150,
      h = 25,
      out = [];
    let bw = 42,
      slots = [];
    for (let t = 0; t < 40; t++) {
      slots = [];
      for (let row = 0; row * h < R - h / 2; row++) {
        const y = -row * h - h / 2;
        const half = Math.sqrt(Math.max(0, R * R - (row * h + h / 2) ** 2));
        const n = Math.max(1, Math.floor((half * 2) / bw));
        const w = (half * 2) / n;
        for (let i = 0; i < n; i++) {
          const x = -half + i * w;
          if (row < 3 && x + w > -34 && x < 34) continue;
          slots.push({ x: x + 2, y: y - h / 2 + 2, w: w - 4, h: h - 4 });
        }
      }
      if (slots.length >= total) break;
      bw *= 0.94;
    }
    slots = slots.slice(0, total);
    out.push(`<ellipse cx="0" cy="6" rx="190" ry="20" fill="url(#contact)"/>`);
    out.push(`<path d="M-150 0 A150 150 0 0 1 150 0 Z" fill="url(#iglooBase)"/>`);
    slots.forEach((s, i) => {
      const on = i < placed;
      const fresh = on && i >= placed - newOnes;
      out.push(
        on
          ? `<g class="brick${fresh ? ' brick-new' : ''}"><rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="5" fill="url(#brick)" stroke="#8FA8CB" stroke-opacity="0.75" stroke-width="1.2"/><path d="M${s.x + 4} ${s.y + s.h - 2.5} H${s.x + s.w - 4}" stroke="#9DB3D3" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/><path d="M${s.x + 4} ${s.y + 3} H${s.x + s.w * 0.6}" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></g>`
          : `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="5" fill="#FFFFFF" fill-opacity="0.18" stroke="#7F97BB" stroke-opacity="0.55" stroke-width="1.3" stroke-dasharray="4 4"/>`,
      );
    });
    out.push(`<ellipse cx="0" cy="10" rx="70" ry="16" fill="url(#spill)"/>`);
    out.push(`<path d="M-32 0 L-32 -46 A32 32 0 0 1 32 -46 L32 0 Z" fill="url(#doorGlow)"/>`);
    out.push(
      `<path d="M-40 0 L-40 -46 A40 40 0 0 1 40 -46 L40 0" fill="none" stroke="#FFFFFF" stroke-width="8" opacity="0.85"/>`,
    );
    return out.join('');
  };

  /** Sled with stacked bricks Google knows about but hasn't read yet. */
  const sled = (count) => {
    let s = `<ellipse cx="60" cy="6" rx="80" ry="10" fill="url(#contact)"/>`;
    for (let i = 0; i < Math.min(count, 15); i++) {
      const col = i % 5,
        row = Math.floor(i / 5);
      s += `<rect x="${6 + col * 23}" y="${-34 - row * 16}" width="21" height="14" rx="3.5" fill="url(#brick)"/>`;
    }
    s += `<rect x="0" y="-18" width="122" height="10" rx="4" fill="url(#wood)"/>
      <path d="M-6 2 L118 2 C 132 2 138 -6 136 -16" fill="none" stroke="#3A4566" stroke-width="4" stroke-linecap="round"/>
      <path d="M14 -8 L14 2 M100 -8 L100 2" stroke="#3A4566" stroke-width="4"/>`;
    return s;
  };

  /** A frozen stream crossing the ground, centred at x=0. */
  const stream = (w = 120) => `
    <path d="M${-w / 2} -2 C ${-w / 4} -10, ${w / 4} 6, ${w / 2} -6 L ${w / 2 + 18} 22 C ${w / 4} 32, ${-w / 4} 18, ${-w / 2 - 16} 28 Z" fill="#8DB8E4"/>
    <path d="M${-w / 2 + 2} 0 C ${-w / 4} -8, ${w / 4} 8, ${w / 2} -4" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
    <path d="M${-w / 2 + 14} 14 C ${-w / 6} 10, ${w / 6} 20, ${w / 2 - 4} 12" fill="none" stroke="#D7E8F8" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M${-w / 2 - 14} 28 C ${-w / 4} 18, ${w / 4} 32, ${w / 2 + 18} 22" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>`;

  /** A plank bridge over the stream. */
  const bridge = (w = 150) => `
    <path class="rope" d="M${-w / 2} 4 Q 0 -18 ${w / 2} 4" fill="none" stroke="#7A4A2C" stroke-width="5" stroke-linecap="round"/>
    ${Array.from({ length: 7 }, (_, i) => {
      const x = -w / 2 + 12 + i * ((w - 24) / 6);
      const y = 4 - 22 * (1 - Math.pow(2 * (x / w), 2)) * 0.8;
      return `<rect class="plank" x="${x - 7}" y="${y - 4}" width="14" height="9" rx="2" fill="url(#wood)"/>`;
    }).join('')}`;

  /** A small pile of snow bricks (pages), n of them. */
  const pile = (n) => {
    let s = `<ellipse cx="22" cy="4" rx="40" ry="7" fill="url(#contact)"/>`;
    const pos = [
      [0, 0],
      [24, 0],
      [12, -15],
      [36, -15],
    ];
    for (let i = 0; i < Math.min(n, 4); i++)
      s += `<rect class="pile-brick" x="${pos[i][0]}" y="${pos[i][1] - 14}" width="22" height="14" rx="3.5" fill="url(#brick)" stroke="#8FA8CB" stroke-opacity="0.7" stroke-width="1.1"/>`;
    return s;
  };

  /** A mailbox on a post; up = flag raised (letter sent). */
  const mailbox = (up) => `
    <ellipse cx="0" cy="4" rx="22" ry="5" fill="url(#contact)"/>
    <rect x="-3" y="-52" width="6" height="56" rx="2" fill="url(#wood)"/>
    <path d="M-20 -52 L 20 -52 L 20 -74 A 20 14 0 0 0 -20 -74 Z" fill="#2F4A8A"/>
    <path d="M-20 -60 L 20 -60" stroke="#24396C" stroke-width="2"/>
    <g transform="translate(20 -66)"><g class="mb-flag" style="transform: rotate(${up ? -90 : 0}deg); transform-origin: 0 0"><rect x="0" y="-2" width="16" height="4" rx="1" fill="#5B6B88"/><rect x="12" y="-8" width="8" height="8" rx="1.5" fill="#FF5A36"/></g></g>`;

  /** An envelope, centred. */
  const envelope = () => `
    <rect x="-18" y="-12" width="36" height="24" rx="3" fill="#F1D9A8" stroke="#B98A45" stroke-width="1.4"/>
    <path d="M-17 -10 L 0 3 L 17 -10" fill="none" stroke="#B98A45" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="7" y="-9" width="7" height="8" rx="1" fill="#FF5A36"/>`;

  /** A wooden signpost; boards = [{text, dir}] where dir is 1 (right) or -1 (left); text '' = blank board. */
  const signpost = (boards) => {
    let s = `<ellipse cx="0" cy="4" rx="26" ry="5" fill="url(#contact)"/><rect x="-4" y="-96" width="8" height="100" rx="2" fill="url(#wood)"/>`;
    boards.forEach((b, i) => {
      const y = -92 + i * 30;
      const w = 86;
      const x0 = b.dir > 0 ? -10 : -w + 10;
      const tip = b.dir > 0 ? `L ${x0 + w + 12} ${y + 11}` : `L ${x0 - 12} ${y + 11}`;
      s += `<g class="board board-${i}">`;
      s +=
        b.dir > 0
          ? `<path d="M${x0} ${y} L ${x0 + w} ${y} ${tip} L ${x0 + w} ${y + 22} L ${x0} ${y + 22} Z" fill="#C9874F"/>`
          : `<path d="M${x0} ${y} L ${x0 + w} ${y} L ${x0 + w} ${y + 22} L ${x0} ${y + 22} ${tip} Z" fill="#C9874F"/>`;
      s += `<path d="M${x0 + 4} ${y + 19} H ${x0 + w - 4}" stroke="#A86B3A" stroke-width="2"/>`;
      if (b.text)
        s += `<text class="sign-text" x="${x0 + w / 2}" y="${y + 15.5}" text-anchor="middle" font-family="IBM Plex Sans, ui-sans-serif, sans-serif" font-size="14" font-weight="600" fill="#2A1A0E">${b.text}</text>`;
      s += `</g>`;
    });
    return s;
  };

  /** A flag on a pole; logo = draw the emblem. */
  const flag = (logo) => `
    <rect x="-2" y="-92" width="4" height="92" rx="1.5" fill="#3A4566"/>
    <circle cx="0" cy="-94" r="4" fill="#F6C453"/>
    <path class="flag-cloth" d="M2 -88 C 22 -94, 34 -80, 56 -86 L 56 -54 C 34 -48, 22 -62, 2 -56 Z" fill="${logo ? '#0B1220' : '#F4F7FB'}" stroke="${logo ? 'none' : '#AFC3DD'}" stroke-width="1.4" ${logo ? '' : 'stroke-dasharray="4 3"'}/>
    ${logo ? `<g class="flag-emblem"><circle cx="29" cy="-71" r="10" fill="none" stroke="#FFFFFF" stroke-width="2.4"/><path d="M25 -76 h8 M25 -76 v10 M25 -71 h6" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" fill="none"/></g>` : ''}`;

  return { defs, penguin, snowman, igloo, sled, stream, bridge, pile, mailbox, envelope, signpost, flag };
})();
