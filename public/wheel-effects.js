/*
 * Эффекты выбывания внутри сектора колеса (Canvas 2D, без зависимостей).
 * Игровое состояние и математический результат определяются только сервером.
 * Используются кадр изображения выбывающего сектора и отдельный прозрачный Canvas.
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  function seeded(seed) {
    let s = seed >>> 0 || 42;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }
  function polygonClip(poly, nx, ny, limit) {
    const result = [];
    if (!poly.length) return result;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const da = a.x * nx + a.y * ny - limit;
      const db = b.x * nx + b.y * ny - limit;
      if ((da < 0) !== (db < 0)) {
        const t = da / (da - db);
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      if (db <= 0) result.push(b);
    }
    return result;
  }
  // Реальные случайные многоугольники: изображение сектора разрезается
  // геометрией Вороного, а не заменяется декоративными квадратиками.
  function makeFragments(area, random, rows = 8, cols = 8) {
    const { x, y, w, h } = area;
    const sites = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        sites.push({
          x: x + ((col + 0.22 + random() * 0.56) / cols) * w,
          y: y + ((row + 0.22 + random() * 0.56) / rows) * h
        });
      }
    }
    const rect = [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
    ];
    return sites.map((site, i) => {
      let poly = rect.slice();
      for (let j = 0; j < sites.length && poly.length; j++) {
        if (i === j) continue;
        const peer = sites[j];
        const nx = peer.x - site.x, ny = peer.y - site.y;
        const limit = (peer.x * peer.x + peer.y * peer.y - site.x * site.x - site.y * site.y) / 2;
        poly = polygonClip(poly, nx, ny, limit);
      }
      const centroid = poly.length ? {
        x: poly.reduce((sum, p) => sum + p.x, 0) / poly.length,
        y: poly.reduce((sum, p) => sum + p.y, 0) / poly.length
      } : site;
      return { poly, centroid, vx: (random() - .5) * 2, vy: random(), spin: (random() - .5) * 3.4, delay: random() * .23, size: random() };
    }).filter(f => f.poly.length > 2);
  }
  function polygon(ctx, coords) {
    if (!coords.length) return;
    ctx.moveTo(coords[0].x, coords[0].y);
    for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i].x, coords[i].y);
    ctx.closePath();
  }
  function traceWedge(ctx, fx) {
    ctx.beginPath();
    ctx.moveTo(fx.cx, fx.cy);
    ctx.arc(fx.cx, fx.cy, fx.radius, fx.startAngle, fx.startAngle + fx.angle, false);
    ctx.closePath();
  }
  function shard(ctx, fx, frag, dx, dy, turn, alpha) {
    if (!frag.poly.length || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(frag.centroid.x + dx, frag.centroid.y + dy);
    ctx.rotate(turn);
    ctx.translate(-frag.centroid.x, -frag.centroid.y);
    ctx.beginPath();
    polygon(ctx, frag.poly);
    ctx.clip();
    // Вырезаем только bounding-box фрагмента, не копируя всё колесо 60 раз за кадр.
    const left = Math.max(0, Math.floor(Math.min(...frag.poly.map(p => p.x)) - 2));
    const top = Math.max(0, Math.floor(Math.min(...frag.poly.map(p => p.y)) - 2));
    const right = Math.min(fx.width, Math.ceil(Math.max(...frag.poly.map(p => p.x)) + 2));
    const bottom = Math.min(fx.height, Math.ceil(Math.max(...frag.poly.map(p => p.y)) + 2));
    if (right > left && bottom > top) {
      const r = fx.pixelRatio;
      ctx.drawImage(fx.image, left * r, top * r, (right - left) * r, (bottom - top) * r,
        left, top, right - left, bottom - top);
    }
    ctx.restore();
  }
  function drawImage(ctx, fx, opacity = 1) {
    if (opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(opacity);
    ctx.drawImage(fx.image, 0, 0, fx.width, fx.height);
    ctx.restore();
  }
  function withinSector(x, y, fx) {
    const dx = x - fx.cx, dy = y - fx.cy;
    if (dx * dx + dy * dy > fx.radius * fx.radius) return false;
    const a = (Math.atan2(dy, dx) - fx.startAngle + TAU * 4) % TAU;
    return a <= fx.angle + .0001;
  }
  function chooseImpact(fx) {
    const mid = fx.startAngle + fx.angle * .5;
    return { x: fx.cx + Math.cos(mid) * fx.radius * .67,
             y: fx.cy + Math.sin(mid) * fx.radius * .67 };
  }
  function crackLines(ctx, fx, amount) {
    const { random, impact } = fx;
    if (!fx.cracks) {
      fx.cracks = [];
      const rays = 13;
      for (let k = 0; k < rays; k++) {
        const a = (k / rays) * TAU + (random() - .5) * .35;
        const line = [{ x: impact.x, y: impact.y }];
        for (let t = 1; t <= 9; t++) {
          const rad = t * fx.radius * .105;
          line.push({ x: impact.x + Math.cos(a + (random() - .5) * .14) * rad,
                      y: impact.y + Math.sin(a + (random() - .5) * .14) * rad });
        }
        fx.cracks.push(line);
        if (k % 2 === 0) {
          const b = line[3];
          const branch = [b];
          for (let t = 1; t <= 5; t++) {
            branch.push({ x: b.x + Math.cos(a + .55 + (random() - .5) * .24) * t * fx.radius * .075,
                          y: b.y + Math.sin(a + .55 + (random() - .5) * .24) * t * fx.radius * .075 });
          }
          fx.cracks.push(branch);
        }
      }
    }
    ctx.save();
    traceWedge(ctx, fx);
    ctx.clip();
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
    const maxPoints = 1 + amount * 9;
    for (const path of fx.cracks) {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      const whole = Math.floor((path.length - 1) * clamp(amount));
      for (let i = 1; i <= whole; i++) ctx.lineTo(path[i].x, path[i].y);
      if (whole < path.length - 1) {
        const p = path[whole], q = path[whole + 1], f = (path.length - 1) * clamp(amount) - whole;
        ctx.lineTo(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f);
      }
      if (maxPoints > 1) {
        ctx.strokeStyle = 'rgba(22,33,44,.72)';
        ctx.lineWidth = Math.max(1, 2 * fx.scale);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(245,250,255,.92)';
        ctx.lineWidth = Math.max(.65, .85 * fx.scale);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawFragmentCracks(ctx, fx, opacity) {
    ctx.save();
    traceWedge(ctx, fx);
    ctx.clip();
    ctx.globalAlpha = opacity;
    ctx.lineWidth = Math.max(.7, 1.1 * fx.scale);
    ctx.strokeStyle = 'rgba(245,250,255,.9)';
    ctx.shadowColor = 'rgba(228,245,255,.6)';
    ctx.shadowBlur = 4 * fx.scale;
    for (const frag of fx.fragments) {
      ctx.beginPath();
      polygon(ctx, frag.poly);
      ctx.stroke();
    }
    ctx.restore();
  }
  function glass(ctx, fx, t) {
    if (t < .29) {
      drawImage(ctx, fx);
      crackLines(ctx, fx, easeOut(t / .29));
      if (t > .16) drawFragmentCracks(ctx, fx, (t - .16) / .13);
      return;
    }
    const elapsed = (t - .29) * fx.duration / 1000;
    const alpha = clamp((1 - t) / .21);
    for (const f of fx.fragments) {
      const sec = Math.max(0, elapsed - f.delay * .65);
      if (!sec) { shard(ctx, fx, f, 0, 0, 0, 1); continue; }
      // Гравитация направлена по экрану вниз, независимо от угла сектора.
      const dx = f.vx * (45 * fx.scale) * sec + Math.sin(sec * 4 + f.size * 12) * 8 * fx.scale;
      const dy = -50 * fx.scale * f.vy * sec + 360 * fx.scale * sec * sec;
      shard(ctx, fx, f, dx, dy, f.spin * sec, t > .77 ? alpha : 1);
    }
  }
  // Схлопывание не растяжением картинки: закрываем дугу сегмента к его началу.
  function fold(ctx, fx, t) {
    const remain = Math.max(.0001, 1 - easeOut(t));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(fx.cx, fx.cy);
    ctx.arc(fx.cx, fx.cy, fx.radius + fx.scale, fx.startAngle, fx.startAngle + fx.angle * remain);
    ctx.closePath();
    ctx.clip();
    drawImage(ctx, fx, 1 - smooth((t - .86) / .14));
    // Мягкий свет вдоль движущейся границы дуги.
    if (remain > .02) {
      const a = fx.startAngle + fx.angle * remain;
      ctx.beginPath(); ctx.moveTo(fx.cx, fx.cy);
      ctx.lineTo(fx.cx + Math.cos(a) * fx.radius, fx.cy + Math.sin(a) * fx.radius);
      ctx.strokeStyle = `rgba(250,248,255,${.25 * (1 - t)})`;
      ctx.lineWidth = fx.scale * 1.8;
      ctx.stroke();
    }
    ctx.restore();
  }
    function particles(ctx, fx, elapsed, kind) {
    for (const p of fx.sparks) {
      const sec = elapsed - p.delay;
      if (sec < 0) continue;
      const life = kind === 'blast' ? .94 : 1.15;
      if (sec >= life) continue;
      ctx.save();
      const r = (kind === 'blast' ? 240 : 170) * fx.scale * sec * (p.speed || 1);
      const px = fx.impact.x + Math.cos(p.a) * r;
      const py = fx.impact.y + Math.sin(p.a) * r + 150 * fx.scale * sec * sec;
      ctx.globalAlpha = (1 - sec / life) * .85;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = (kind === 'blast' ? 13 : 7) * fx.scale;
      ctx.beginPath(); ctx.arc(px, py, Math.max(.8, p.size * fx.scale), 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  function blast(ctx, fx, t) {
    const sec = t * fx.duration / 1000;
    if (t < .1) drawImage(ctx, fx);
    else for (const f of fx.fragments) {
      const d = Math.max(0, sec - .15 - f.delay * .3);
      const vx = (f.centroid.x - fx.impact.x) / fx.radius;
      const vy = (f.centroid.y - fx.impact.y) / fx.radius;
      const power = 1.3 + f.size;
      shard(ctx, fx, f, vx * d * 340 * power * fx.scale,
        vy * d * 330 * power * fx.scale + d * d * 210 * fx.scale,
        d * f.spin * 1.9, clamp((1 - t) / .48));
    }
    if (t < .4) {
      const glow = ctx.createRadialGradient(fx.impact.x, fx.impact.y, 0,
        fx.impact.x, fx.impact.y, (60 + t * 220) * fx.scale);
      glow.addColorStop(0, `rgba(255,248,209,${clamp(1.1 - t * 3)})`);
      glow.addColorStop(.22, `rgba(255,165,69,${clamp(.77 - t)})`);
      glow.addColorStop(1, 'rgba(255,80,30,0)');
      ctx.fillStyle = glow; ctx.beginPath();
      ctx.arc(fx.impact.x, fx.impact.y, (60 + t * 220) * fx.scale, 0, TAU); ctx.fill();
    }
    particles(ctx, fx, sec, 'blast');
  }
  // Не мишень из концентрических окружностей: небольшой неровный прокол.
  function bulletPuncture(ctx, fx) {
    const { x, y } = fx.impact;
    const r = 6.5 * fx.scale;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 17; i++) {
      const a = TAU * i / 17;
      const noise = .82 + .18 * Math.sin(i * 7.3 + fx.seed);
      const px = x + Math.cos(a) * r * noise;
      const py = y + Math.sin(a) * r * noise;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#17060b';
    ctx.shadowColor = '#48020a'; ctx.shadowBlur = 5 * fx.scale;
    ctx.fill();
    ctx.restore();
  }

  // Верхнее кровяное пятно и несколько густых, неодинаково длинных потёков.
  // Кровь течёт строго по экрану вниз, не поворачиваясь с колесом.
  function drawBlood(ctx, fx, t) {
    const progress = smooth((t - .08) / .74);
    if (progress <= 0) return;
    const { x, y } = fx.impact;
    const k = fx.scale;
    const spread = Math.min(37 * k, Math.max(12 * k, fx.radius * fx.angle * .55));
    const top = y - 7 * k;
    const ends = [.62, 1, .48, .81, .36];
    const widths = [.095, .10, .065, .085, .075];
    const lengths = [110, 198, 145, 175, 94];
    ctx.save();
    ctx.globalAlpha = 1 - smooth((t - .88) / .12);
    ctx.beginPath();
    // Густая широкая шапка крови вокруг отверстия без круглой мишени.
    ctx.moveTo(x - spread, top + 1 * k);
    ctx.bezierCurveTo(x - spread * 1.06, top - 11 * k, x - spread * .60, top - 12 * k, x - spread * .34, top - 11 * k);
    ctx.bezierCurveTo(x - spread * .04, top - 5 * k, x + spread * .18, top - 12 * k, x + spread * .42, top - 9 * k);
    ctx.bezierCurveTo(x + spread * .95, top - 10 * k, x + spread * 1.12, top + 1 * k, x + spread, top + 12 * k);
    ctx.bezierCurveTo(x + spread * .85, top + 19 * k, x + spread * .57, top + 14 * k, x + spread * .36, top + 15 * k);
    ctx.bezierCurveTo(x + spread * .01, top + 23 * k, x - spread * .57, top + 19 * k, x - spread * .84, top + 12 * k);
    ctx.closePath();
    // Растущие вязкие струи, каждой свой темп и длина. Капля на конце — часть силуэта.
    for (let i = 0; i < ends.length; i++) {
      const offset = (i - 2) * .39;
      const bx = x + spread * offset;
      const by = top + (15 + ((i * 7) % 6)) * k;
      const width = Math.max(2.2 * k, spread * widths[i]);
      const travel = Math.min(fx.height - by - 3 * k, lengths[i] * k) * progress * ends[i];
      const sway = Math.sin(progress * 3.2 + i * 2.4) * 2.6 * k;
      const tx = bx + sway + (i - 2) * 1.5 * k;
      const ty = by + travel;
      if (travel < 1) continue;
      ctx.moveTo(bx - width, by - 3 * k);
      ctx.bezierCurveTo(bx - width * 1.1, by + travel * .27,
        tx - width * .72, by + travel * .64, tx - width * .75, ty - width);
      ctx.bezierCurveTo(tx - width * 1.2, ty + width * .5, tx - width * .52, ty + width * 1.7, tx, ty + width * 1.8);
      ctx.bezierCurveTo(tx + width * .82, ty + width * 1.5, tx + width * 1.25, ty + width * .42, tx + width * .75, ty - width);
      ctx.bezierCurveTo(tx + width * .65, by + travel * .60, bx + width * 1.1, by + travel * .16, bx + width, by - 3 * k);
      ctx.closePath();
    }
    const blood = ctx.createLinearGradient(x - spread, top, x + spread, top + 80 * k);
    blood.addColorStop(0, '#760009');
    blood.addColorStop(.46, '#b60811');
    blood.addColorStop(1, '#55000d');
    ctx.fillStyle = blood;
    ctx.shadowColor = 'rgba(51,0,5,.42)';
    ctx.shadowBlur = 4 * k;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Узкие глянцевые отблески на основных потёках, не красная паутина.
    ctx.strokeStyle = 'rgba(255,102,100,.38)';
    ctx.lineWidth = 1.15 * k; ctx.lineCap = 'round';
    for (const i of [1, 3]) {
      const bx = x + spread * (i - 2) * .39;
      const h = Math.min(fx.height - top - 25 * k, lengths[i] * k) * progress * ends[i];
      ctx.beginPath(); ctx.moveTo(bx - 1.6 * k, top + 17 * k);
      ctx.quadraticCurveTo(bx - 3 * k, top + h * .5, bx, top + Math.max(16 * k, h - 6 * k));
      ctx.stroke();
    }
    ctx.restore();
  }
  function shot(ctx, fx, t) {
    drawImage(ctx, fx, 1 - smooth((t - .91) / .09));
    if (t < .045) return;
    drawBlood(ctx, fx, t);
    ctx.save();
    ctx.globalAlpha = 1 - smooth((t - .9) / .1);
    bulletPuncture(ctx, fx);
    ctx.restore();
  }
    // Жвачка: сектор чуть раздувается и дрожит; затем липкая плёнка
  // разрывается на тянущиеся нити, остатки падают под силой тяжести.
  function bubble(ctx, fx, t) {
    const burstAt = .49;
    if (t < burstAt) {
      const f = t / burstAt;
      const radiusScale = 1 + .07 * smooth(f);
      const shake = (f > .28 ? Math.pow(f, 2) : 0) * 2.6 * fx.scale;
      ctx.save();
      ctx.translate(fx.impact.x + Math.sin(f * 92) * shake, fx.impact.y + Math.cos(f * 69) * shake * .6);
      ctx.scale(radiusScale * (1 + .004 * Math.sin(f * 67)), radiusScale * (1 - .005 * Math.cos(f * 78)));
      ctx.translate(-fx.impact.x, -fx.impact.y);
      drawImage(ctx, fx);
      ctx.restore();
      ctx.save();
      traceWedge(ctx, fx); ctx.clip();
      ctx.fillStyle = `rgba(252,153,192,${.045 + .12 * f})`;
      ctx.fillRect(0, 0, fx.width, fx.height);
      ctx.restore();
      return;
    }
    const e = (t - burstAt) / (1 - burstAt);
    const fall = 280 * fx.scale * e * e;
    // Порвавшаяся мембрана с остатками изображения на упругих лоскутках.
    for (let i = 0; i < fx.fragments.length; i += 4) {
      const f = fx.fragments[i];
      const d = (i % 7 + 1) / 7;
      shard(ctx, fx, f, (f.centroid.x - fx.impact.x) * e * .20,
        fall * (.6 + d) - e * 27 * fx.scale,
        Math.sin(e * 6 + i) * e * .27, 1 - smooth((e - .7) / .3));
    }
    ctx.save();
    ctx.globalAlpha = 1 - smooth((e - .78) / .22);
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const span = fx.radius * (.16 + (i % 4) * .07);
      const x = fx.impact.x + Math.cos(a) * span;
      const y = fx.impact.y + Math.sin(a) * span;
      const bx = x + Math.cos(a) * (18 + e * 45) * fx.scale;
      const by = y + Math.sin(a) * e * 65 * fx.scale + e * e * 190 * fx.scale;
      const lean = Math.sin(e * 8 + i) * (10 + 10 * e) * fx.scale;
      ctx.beginPath();
      ctx.moveTo(fx.impact.x + Math.cos(a) * 7 * fx.scale, fx.impact.y + Math.sin(a) * 7 * fx.scale);
      ctx.bezierCurveTo(x - lean * .4, y - 24 * fx.scale,
        bx + lean, by - 65 * (1 - e) * fx.scale, bx, by);
      ctx.strokeStyle = i % 3 ? 'rgba(239,119,158,.83)' : 'rgba(255,195,217,.93)';
      ctx.lineWidth = (2.5 + (i % 3) * 1.2) * fx.scale * (1 - .6 * e);
      ctx.stroke();
      ctx.fillStyle = '#ea86ac'; ctx.beginPath();
      ctx.ellipse(bx, by, (2.6 + (i % 3)) * fx.scale, (3.8 + (i % 4)) * fx.scale, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  // Ровная диагональная линия вместо кривой Безье.
  function slashPath(ctx, fx) {
    const { x, w, h } = fx.bounds;
    const centerY = fx.impact.y;
    ctx.moveTo(x - 45, centerY + h * .13);
    ctx.lineTo(x + w + 45, centerY - h * .13);
  }
  function slash(ctx, fx, t) {
    if (t < .28) drawImage(ctx, fx);
    if (t >= .2) {
      const move = smooth((t - .3) / .7);
      ctx.save();
      ctx.translate(0, -move * 38 * fx.scale);
      ctx.rotate(-move * .035);
      ctx.beginPath();
      const { x, y, w } = fx.bounds;
      slashPath(ctx, fx);
      ctx.lineTo(x + w + 50, y - fx.height);
      ctx.lineTo(x - 50, y - fx.height);
      ctx.closePath(); ctx.clip();
      drawImage(ctx, fx, 1 - smooth((t - .8) / .2));
      ctx.restore();
      ctx.save();
      ctx.translate(0, move * move * 245 * fx.scale);
      ctx.rotate(move * .085);
      ctx.beginPath();
      slashPath(ctx, fx);
      ctx.lineTo(x + w + 50, y + fx.height * 2);
      ctx.lineTo(x - 50, y + fx.height * 2);
      ctx.closePath(); ctx.clip();
      drawImage(ctx, fx, 1 - smooth((t - .75) / .25));
      ctx.restore();
    }
    if (t < .57) {
      ctx.save();
      ctx.globalAlpha = 1 - smooth((t - .37) / .2);
      ctx.strokeStyle = 'rgba(253,255,255,.95)';
      ctx.lineWidth = 2.4 * fx.scale;
      ctx.shadowColor = '#a1e7f0'; ctx.shadowBlur = 12 * fx.scale;
      ctx.beginPath(); slashPath(ctx, fx); ctx.stroke();
      ctx.restore();
    }
  }
  // Единственная радиальная трещина от ступицы до края сектора.
  // Часть, которая визуально выше, скользит по второй и отпадает вниз.
  function split(ctx, fx, t) {
    const mid = fx.startAngle + fx.angle * .5;
    const a = [{ start: fx.startAngle, angle: fx.angle / 2 },
      { start: mid, angle: fx.angle / 2 }];
    const upperIndex = Math.sin(a[0].start + a[0].angle / 2) <
      Math.sin(a[1].start + a[1].angle / 2) ? 0 : 1;
    const move = smooth((t - .28) / .65);
    for (let i = 0; i < 2; i++) {
      const upper = i === upperIndex;
      ctx.save();
      if (upper && t >= .28) {
        // Краткое скольжение по нижней части, затем ускоренное падение.
        const slip = smooth((t - .28) / .27);
        const fall = Math.pow(clamp((t - .43) / .57), 2);
        ctx.translate(slip * 28 * fx.scale, slip * 8 * fx.scale + fall * 480 * fx.scale);
        ctx.translate(fx.cx, fx.cy);
        ctx.rotate(-slip * .08 + fall * .34);
        ctx.translate(-fx.cx, -fx.cy);
      }
      ctx.beginPath(); ctx.moveTo(fx.cx, fx.cy);
      ctx.arc(fx.cx, fx.cy, fx.radius + fx.scale, a[i].start, a[i].start + a[i].angle);
      ctx.closePath(); ctx.clip();
      drawImage(ctx, fx, upper ? 1 - smooth((t - .84) / .16) : 1 - smooth((t - .68) / .32));
      ctx.restore();
    }
    if (t < .55) {
      const len = easeOut(t / .3);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(fx.cx, fx.cy);
      ctx.lineTo(fx.cx + Math.cos(mid) * fx.radius * len,
        fx.cy + Math.sin(mid) * fx.radius * len);
      ctx.strokeStyle = '#1b1020'; ctx.lineWidth = 4 * fx.scale;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,249,246,.85)'; ctx.lineWidth = 1.25 * fx.scale;
      ctx.stroke(); ctx.restore();
    }
  }
    function glitch(ctx, fx, t) {
    const { x, y, w, h } = fx.bounds;
    const bands = 21;
    for (let i = 0; i < bands; i++) {
      const sy = y + (i / bands) * h;
      const sh = h / bands + 1;
      const jitter = (t > .14 ? Math.sin(i * 15.7 + Math.floor(t * 44) * 4) : 0) * (3 + 25 * t) * fx.scale;
      ctx.save();
      ctx.globalAlpha = 1 - smooth((t - .62) / .38) * ((i % 3) ? 1 : .7);
      const r = fx.pixelRatio;
      ctx.drawImage(fx.image, x * r, sy * r, w * r, sh * r, x + jitter, sy, w, sh);
      if (i % 5 === 0 && t > .22) {
        ctx.globalAlpha = .18 * (1 - t);
        ctx.fillStyle = i % 2 ? '#fa4e9f' : '#58e0ee';
        ctx.fillRect(x + jitter, sy, w, sh);
      }
      ctx.restore();
    }
  }
  function pixels(ctx, fx, t) {
    const grid = fx.pixels;
    for (const pix of grid) {
      const start = .17 + pix.delay * .46;
      const e = clamp((t - start) / (1 - start));
      ctx.save();
      ctx.globalAlpha = 1 - smooth((e - .65) / .35);
      const dx = (pix.x - fx.impact.x) * e * (.1 + pix.speed * .24);
      const dy = -e * pix.speed * 47 * fx.scale + e * e * 230 * fx.scale;
      ctx.translate(dx, dy);
      ctx.rotate(e * pix.spin * .8);
      const r = fx.pixelRatio;
      ctx.drawImage(fx.image, pix.x * r, pix.y * r, pix.w * r, pix.h * r,
        pix.x, pix.y, pix.w, pix.h);
      ctx.restore();
    }
  }
  function vortex(ctx, fx, t) {
    const angle = easeOut(t) * 5.8 * Math.PI;
    const scale = Math.pow(1 - clamp(t), 1.9);
    ctx.save();
    ctx.translate(fx.impact.x, fx.impact.y);
    ctx.rotate(angle);
    ctx.scale(Math.max(.001, scale), Math.max(.001, scale));
    ctx.translate(-fx.impact.x, -fx.impact.y);
    drawImage(ctx, fx, 1 - smooth((t - .68) / .32));
    ctx.restore();
  }
  const animations = { fold, glass, blast, shot, bubble, slash, split, glitch, pixels, vortex };
  class WheelSectorEffects {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.active = null;
      this.frame = null;
    }
    start(options) {
      this.cancel();
      const { wheelCanvas, geometry, index, slices, rotation, kind, seed = 42,
        duration = 2550, onComplete = () => {} } = options;
      const { width, height, cx, cy, radius, scale } = geometry;
      const ratio = wheelCanvas.width / width;
      this.canvas.width = wheelCanvas.width;
      this.canvas.height = wheelCanvas.height;
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const random = seeded(seed);
      const startAngle = rotation + TAU * slices.slice(0, index).reduce((a, s) => a + s.share, 0);
      const angle = TAU * slices[index].share;
      const samplePoints = [{ x: cx, y: cy }];
      const steps = Math.max(3, Math.ceil(angle * 36));
      for (let i = 0; i <= steps; i++) {
        const a = startAngle + angle * i / steps;
        samplePoints.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
      }
      const x = Math.max(0, Math.min(...samplePoints.map(p => p.x)));
      const y = Math.max(0, Math.min(...samplePoints.map(p => p.y)));
      const maxX = Math.min(width, Math.max(...samplePoints.map(p => p.x)));
      const maxY = Math.min(height, Math.max(...samplePoints.map(p => p.y)));
      const bounds = { x, y, w: Math.max(1, maxX - x), h: Math.max(1, maxY - y) };
      // Снимок сохраняет именно пиксели исходного сектора: цвет + надпись + очки.
      const image = document.createElement('canvas');
      image.width = wheelCanvas.width;
      image.height = wheelCanvas.height;
      const sourceCtx = image.getContext('2d');
      sourceCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      sourceCtx.beginPath(); sourceCtx.moveTo(cx, cy);
      sourceCtx.arc(cx, cy, radius + scale, startAngle, startAngle + angle);
      sourceCtx.closePath(); sourceCtx.clip();
      sourceCtx.drawImage(wheelCanvas, 0, 0, width, height);
      const fx = { width, height, cx, cy, radius, scale, pixelRatio: ratio, image, startAngle, angle,
        duration, kind: animations[kind] ? kind : 'fold', random, bounds, seed, onComplete };
      fx.impact = chooseImpact(fx);
      fx.fragments = makeFragments(bounds, random, angle < .5 ? 9 : 8, angle < .5 ? 7 : 9);
      fx.sparks = Array.from({ length: 62 }, (_, i) => ({
        a: i * 2.39996 + random() * .27,
        delay: random() * .28, speed: .45 + random() * 1.2,
        size: 1 + random() * 3,
        color: ['#ffdc99', '#f7aa62', '#d9859d', '#a2eaf1'][i % 4]
      }));
      fx.pixels = [];
      const pixelSide = Math.max(6, 13 * scale);
      for (let py = bounds.y; py < bounds.y + bounds.h; py += pixelSide) {
        for (let px = bounds.x; px < bounds.x + bounds.w; px += pixelSide) {
          fx.pixels.push({ x: px, y: py, w: Math.min(pixelSide, width - px),
            h: Math.min(pixelSide, height - py), speed: random(), delay: random(), spin: (random() - .5) * 3 });
        }
      }
      fx.startTime = performance.now();
      this.active = fx;
      const render = now => {
        if (this.active !== fx) return;
        this.frame = null;
        const t = clamp((now - fx.startTime) / fx.duration);
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.save();
        animations[fx.kind](this.ctx, fx, t);
        this.ctx.restore();
        if (t < 1) this.frame = requestAnimationFrame(render);
        else {
          this.active = null;
          this.ctx.clearRect(0, 0, width, height);
          fx.onComplete();
        }
      };
      this.frame = requestAnimationFrame(render);
      return fx.kind;
    }
    cancel() {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.active = null;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
  window.WheelSectorEffects = WheelSectorEffects;
})();
