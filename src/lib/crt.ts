// The CRT filter's picture: the game drawn again, by the GPU, the way a tube with an aperture grille
// shows it.
//
// A filter laid over the game can only darken it, and part of a tube's look is added light: white
// spilling past its own edges into the glass. So this reads PICO-8's canvas every frame and draws
// the whole picture, in two passes. The first softens each row across, just enough to round off
// the ends of a pixel, into a fixed texture. The second runs at the screen's own device pixels, and
// is the only one whose cost grows with the screen: it draws each row as a scanline with a dark
// gap below it, lays the grille's RGB stripes over them, and adds the glow, read from the first
// texture's mipmaps.
//
// It keeps the pixels and the scanlines of the overlay it replaced (still in src/styles/_crt.scss,
// as the fallback), and takes only the glass's glow from a softer tube. A phosphor honeycomb was
// tried first and closer to a photo of one, but blurred PICO-8's 1-pixel font and hid the lines.
//
// No animation, so nothing here for prefers-reduced-motion to turn off.

/** PICO-8's screen is this many pixels across, whatever size it's drawn. */
export const GAME_PIXELS = 128;

// Four to a game pixel, so the mipmaps the glow reads are as fine as the picture across and down
// alike, and a power of two, which they need in WebGL 1.
const BEAM_SIZE = 512;

const VERTEX = `
attribute vec2 corner;
varying vec2 uv;

void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const BEAM = `
precision highp float;
varying vec2 uv;
uniform sampler2D game;

// The beam's spot across, in game pixels, as a Gaussian's sigma: it rounds a pixel's ends without
// blurring one into the next. Only the two nearest pixels are near enough to count. Down, nothing
// mixes: the screen pass draws each row as its own scanline.
const float SPOT = 0.2;

// Beams add as light, and what a screen stores is close to the square root of that.
vec3 light(vec2 pixel) {
  vec3 colour = texture2D(game, (pixel + 0.5) / ${GAME_PIXELS}.0).rgb;
  return colour * colour;
}

void main() {
  // The canvas's rows run top down and GL's bottom up, so the flip is here, not in the upload.
  vec2 position = vec2(uv.x, 1.0 - uv.y) * ${GAME_PIXELS}.0;
  float row = floor(position.y);
  float x = position.x - 0.5;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i <= 1; i++) {
    float column = floor(x) + float(i);
    float away = x - column;
    float weight = exp(-away * away / (2.0 * SPOT * SPOT));
    sum += light(vec2(column, row)) * weight;
    total += weight;
  }
  gl_FragColor = vec4(sqrt(sum / total), 1.0);
}`;

const SCREEN = `
precision highp float;
varying vec2 uv;
uniform sampler2D beam;
uniform float mipShift;

// How far a scanline reaches from its centre, in game pixels, for a dark row and a white one: a
// harder-driven beam is wider, so the gaps close up a little in white and stay dark in shadow.
const float LINE_DARK = 0.36;
const float LINE_BRIGHT = 0.44;
const float STRIPE = 0.6;       // what each stripe of the grille lets through of the other two colours
const float DRIVE = 1.75;       // makes up the light the gaps and stripes stop
const float UNLIT = 0.001;      // the faint stripes of a black that's still a lit tube
const float SATURATION = 1.12;
const float EXPOSURE = 1.3;
const float VIGNETTE = 0.25;

// A row's light, read at its centre, where the beam pass left it unmixed with the rows beside it.
// Past the top and bottom there are none, so the edge rows stay as thin as the rest.
//
// Always the full-size level, whatever the GPU works out. It picks a mip level from how far the
// coordinates move between neighbouring pixels, and these jump a whole row at each row's edge, so
// left to itself it reads a blurred level there and smears every line sideways. The bias only has
// to be far enough below zero to cover that jump; any lower is clamped to the full-size level.
vec3 rowLight(float row) {
  if (row < 0.0 || row > ${GAME_PIXELS - 1}.0) return vec3(0.0);
  vec3 colour = texture2D(beam, vec2(uv.x, (row + 0.5) / ${GAME_PIXELS}.0), -16.0).rgb;
  return colour * colour;
}

// How much of a row's light reaches this far from its centre. A fourth power, not a Gaussian's
// square, so a line stays flat across most of its height and the gap below it is a clean one.
float line(float away, vec3 lit) {
  float reach = away / mix(LINE_DARK, LINE_BRIGHT, max(lit.r, max(lit.g, lit.b)));
  reach *= reach;
  return exp(-reach * reach);
}

// The beam's light at a mip level, whatever size the screen is.
vec3 lightAt(float mip) {
  vec3 colour = texture2D(beam, uv, mip + mipShift).rgb;
  return colour * colour;
}

void main() {
  float y = uv.y * ${GAME_PIXELS}.0 - 0.5;
  float row = floor(y);
  float down = y - row;
  vec3 near = rowLight(row);
  vec3 next = rowLight(row + 1.0);
  vec3 lit = near * line(down, near) + next * line(1.0 - down, next);

  // The grille: red, green and blue stripes, a device pixel each, whatever size the game is drawn.
  float column = mod(floor(gl_FragCoord.x), 3.0);
  vec3 stripe = 1.0 - min(abs(vec3(column) - vec3(0.0, 1.0, 2.0)), 1.0);
  vec3 mask = STRIPE + (1.0 - STRIPE) * stripe;
  vec3 colour = lit * mask * DRIVE + UNLIT * mask;

  // Over the scanlines, not under them: this is light scattering in the glass.
  colour += lightAt(2.0) * 0.05 + lightAt(3.0) * 0.04 + lightAt(4.5) * 0.035;

  float grey = dot(colour, vec3(0.3, 0.6, 0.1));
  colour = max(mix(vec3(grey), colour, SATURATION), 0.0);

  // Rolls off instead of clipping, so overdriven colours head for white as they do on glass.
  colour = 1.0 - exp(-colour * EXPOSURE);

  vec2 edge = uv * 2.0 - 1.0;
  colour *= 1.0 - VIGNETTE * pow(dot(edge, edge) * 0.5, 2.0);
  gl_FragColor = vec4(sqrt(colour), 1.0);
}`;

/** Draws the game's current picture, size device pixels square. */
export type DrawCrt = (game: HTMLCanvasElement, size: number) => void;

function program(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const linked = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!linked || !shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(linked, shader);
  }
  if (!linked) return null;
  gl.bindAttribLocation(linked, 0, 'corner');
  gl.linkProgram(linked);
  return gl.getProgramParameter(linked, gl.LINK_STATUS) ? linked : null;
}

function texture(gl: WebGLRenderingContext, min: number, mag: number): WebGLTexture | null {
  const made = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, made);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return made;
}

// Everything the context holds, which a lost context takes with it.
function build(gl: WebGLRenderingContext) {
  const beamPass = program(gl, BEAM);
  const screenPass = program(gl, SCREEN);
  if (!beamPass || !screenPass) return null;

  // One triangle over the whole viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const game = texture(gl, gl.NEAREST, gl.NEAREST);
  const beam = texture(gl, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BEAM_SIZE, BEAM_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const target = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, beam, 0);

  return {
    beamPass,
    screenPass,
    game,
    beam,
    target,
    mipShift: gl.getUniformLocation(screenPass, 'mipShift'),
  };
}

/**
 * Sets up a canvas to draw on, or returns null if this browser can't. Nothing is drawn until the
 * first draw, and a lost context draws nothing until it's back, so the canvas stays transparent
 * and whatever is behind it shows: see .crt-screen, which is the filter for those cases.
 *
 * Nothing to tear down: the context goes with its canvas. Don't lose it on purpose in an effect's
 * cleanup. A canvas has one context for life, so StrictMode's second mount would get the dead one
 * back, and the filter would quietly be the fallback from then on.
 */
export function createCrt(tube: HTMLCanvasElement): DrawCrt | null {
  const gl = tube.getContext('webgl', { antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  let built = build(gl);
  if (!built) return null;

  // Phones take contexts away from pages in the background. Cancelling this asks for it back.
  tube.addEventListener('webglcontextlost', (event) => event.preventDefault());
  tube.addEventListener('webglcontextrestored', () => {
    built = build(gl);
  });

  return (game, size) => {
    if (!built) return;
    if (tube.width !== size) {
      tube.width = size;
      tube.height = size;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, built.target);
    gl.viewport(0, 0, BEAM_SIZE, BEAM_SIZE);
    gl.useProgram(built.beamPass);
    gl.bindTexture(gl.TEXTURE_2D, built.game);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, game);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size, size);
    gl.useProgram(built.screenPass);
    gl.bindTexture(gl.TEXTURE_2D, built.beam);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1f(built.mipShift, Math.log2(size / BEAM_SIZE));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
