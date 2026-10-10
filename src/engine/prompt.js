'use strict';

/**
 * 绘图提示词编译器。
 * 输入：角色卡 + 场景 + heat + rating + target
 * 输出：可直接粘进 SD / NovelAI / MJ / ComfyUI 的完整提示词
 */

const { joinTags, wordCount } = require('../util/text');
const { resolve, makeScope } = require('./tokens');
const { Rng } = require('../util/rng');

/** 评级：显式度 */
const RATING_TAGS = {
  safe: {
    prefix: ['safe', 'general audience'],
    suffix: [],
    negativeExtra: [
      'nsfw', 'explicit', 'nude', 'nipples', 'pubic hair', 'sex', 'penetration',
      'cleavage', 'see-through', 'lingerie',
    ],
  },
  suggestive: {
    prefix: ['suggestive', 'ecchi', 'provocative pose'],
    suffix: ['slightly parted lips', 'heavy breathing', 'flushed skin', 'close eye contact', 'disheveled clothes'],
    negativeExtra: ['nude', 'nipples', 'pubic hair', 'explicit sex', 'penetration', 'genitalia'],
  },
  nsfw: {
    prefix: ['nsfw', 'questionable'],
    suffix: ['partially undressed', 'exposed breasts', 'erect nipples', 'hand between legs', 'aroused expression', 'blush', 'sweat'],
    negativeExtra: ['pubic hair', 'explicit penetration', 'cum', 'genitalia close-up'],
  },
  explicit: {
    prefix: ['nsfw', 'explicit', 'uncensored'],
    suffix: [
      'completely nude', 'exposed breasts', 'erect nipples', 'spread legs', 'penetration',
      'vaginal sex', 'fluids', 'climax expression', 'rolled eyes', 'open mouth', 'tongue out',
      'shiny skin', 'sweat drops', 'messy hair', 'gripping sheets', 'arched back',
    ],
    negativeExtra: [],
  },
};

const BASE_NEGATIVE = [
  'lowres', 'worst quality', 'low quality', 'jpeg artifacts', 'blurry', 'bad anatomy',
  'bad hands', 'extra fingers', 'fused fingers', 'extra limbs', 'missing limbs', 'malformed limbs',
  'long neck', 'deformed face', 'asymmetrical eyes', 'cross-eyed', 'watermark', 'signature', 'text',
  'username', 'logo', 'artist name', 'duplicate', 'cropped', 'out of frame', 'mutation',
];

const MINOR_NEGATIVE = [
  'child', 'loli', 'shota', 'toddler', 'infant', 'underage', 'minor',
  'elementary school', 'kindergarten', 'school uniform', 'petite child body',
  'flat chest child', 'child face',
];

const AGE_TAGS = {
  18: '18 years old',
  19: '19 years old',
  20: '20 years old',
  21: '21 years old',
  22: '22 years old',
  23: '23 years old',
  24: '24 years old',
  25: '25 years old',
  26: '26 years old',
  27: '27 years old',
  29: '29 years old',
  31: '31 years old',
  33: '33 years old',
};

function ageTag(c) {
  if (typeof c.age !== 'number' || c.age < 18) {
    throw new Error(`[age-gate] 角色 ${c.id || c.name} 的 age=${c.age}，未满 18 不可进入绘图引擎`);
  }
  return AGE_TAGS[c.age] || `${c.age} years old`;
}

function poseTags(heat, rating, kinkFamily) {
  const byHeat = {
    1: ['standing', 'arms crossed', 'looking away'],
    2: ['leaning against wall', 'close up', 'slight smile'],
    3: ['sitting on edge', 'one knee raised', 'hand on partner cheek', 'kiss'],
    4: ['straddling', 'hand on partner thigh', 'kiss on neck', 'arched back', 'bitten lip'],
    5: ['bent over', 'legs spread', 'penetration', 'gripping partner', 'trembling thighs', 'mid climax'],
  };
  const byKink = {
    'medical-play': ['stethoscope in hand', 'white coat half open', 'sitting on examination bed'],
    'power-exchange': ['wrist held', 'kneeling on command', 'standing against floor to ceiling window'],
    sweat: ['sweat soaked sports bra', 'ponytail swinging', 'fresh from workout'],
    'sensory-overload': ['paint on skin', 'eyes closed', 'hands tied with ribbon'],
    'body-worship': ['mirror reflection', 'flexing back muscles', 'oil on skin'],
    'orgasm-control': ['hand between own legs', 'denied expression', 'thighs pressed together'],
    'slow-sensual': ['slow embrace', 'forehead touch', 'unbuttoning shirt slowly'],
    'shy-tease': ['covering face', 'blushing hard', 'hands clasped to chest'],
    'rough-care': ['pinned against motorcycle', 'leather jacket', 'rain wet'],
    'tension-release': ['glasses removed', 'hair loose', 'gripping desk edge'],
    'public-tease': ['dark corridor', 'hand over mouth', 'listening for footsteps'],
    marking: ['paint handprint on skin', 'biting shoulder', 'marked skin'],
    overstimulation: ['tangled in blanket', 'flushed all over', 'teary eyes'],
    'possessive-rescue': ['held from behind', 'jacket over shoulders', 'protective embrace'],
    'awkward-burn': ['cluttered supply room', 'nervous laughter', 'hands unsure where to go'],
    aftercare: ['blanket wrapped', 'head on chest', 'gentle patting back'],
  };
  const list = [...(byHeat[heat] || byHeat[3])];
  if (byKink[kinkFamily]) list.push(...byKink[kinkFamily]);
  const r = RATING_TAGS[rating] || RATING_TAGS.explicit;
  return [...list, ...r.suffix];
}

/** 场景提示词：从 scene.tags + mood + 角色 imagery.scenes 编译 */
function sceneTagsFor(scene, cast, rng) {
  const out = [];
  if (scene) {
    out.push(...(scene.tags || []));
    if (scene.location) out.push(scene.location);
  }
  for (const c of cast) {
    const sc = (c.imagery && c.imagery.scenes) || [];
    if (sc.length) out.push(rng.pick(sc));
  }
  return out;
}

const TARGETS = {
  sdxl: { label: 'SDXL / SD1.5 (A1111 · Forge · reForge)', maxTokens: 0, negative: true },
  pony: { label: 'Pony Diffusion V6 XL', maxTokens: 0, negative: true, ponyPrefix: true },
  novelai: { label: 'NovelAI Diffusion V4 / V3', maxTokens: 0, negative: true, naiStyle: true },
  midjourney: { label: 'Midjourney v6 / v7', maxTokens: 0, negative: false, mj: true },
  comfyui: { label: 'ComfyUI (workflow JSON)', maxTokens: 0, negative: true, comfy: true },
  generic: { label: '通用 markdown 提示词包', maxTokens: 0, negative: true, plain: true },
};

/**
 * 编译一条提示词。
 * @returns {{positive:string,negative:string,params:object,target:string,label:string,workflow?:object}}
 */
function compilePrompt({
  character,
  scene = null,
  cast = [],
  heat = 4,
  rating = 'explicit',
  target = 'sdxl',
  extras = [],
  seed,
  width,
  height,
  cfg,
  steps,
  sampler,
  model,
} = {}) {
  const cfgData = require('./datastore').config();
  const pcfg = cfgData.prompt || {};
  const rng = new Rng(seed != null ? `prompt:${seed}` : `prompt:${Date.now()}`);

  const primary = character;
  if (!primary) throw new Error('compilePrompt 需要 character');
  const age = ageTag(primary);
  const others = (cast && cast.length ? cast : []).filter((c) => c && c.id !== primary.id);

  const r = RATING_TAGS[rating] ? rating : 'explicit';
  const ratingDef = RATING_TAGS[r];

  // 正向前缀：质量 → 年龄 → 造型 → 场景 → 姿势 → 身体细节
  const quality = [...(primary.appearance.quality || ['photorealistic'])];
  const anchors = [...(primary.appearance.loraAnchors || []).map((l) => `<lora:${l}:0.8>`)];
  const style = primary.appearance.tags || [];
  const bodyTags = [
    primary.body ? `${primary.body.frame}` : null,
    primary.body ? `${primary.body.bust}` : null,
    primary.body ? `${primary.body.waist}` : null,
    primary.body ? `${primary.body.hip}` : null,
    primary.body ? `${primary.body.skin}` : null,
    primary.body && primary.body.marks ? `${primary.body.marks}` : null,
  ].filter(Boolean);

  const sceneTags = sceneTagsFor(scene, [primary, ...others], rng);
  const camera = [primary.appearance.cameraDefault, ...((scene && scene.camera) || [])].filter(Boolean);
  const poses = poseTags(heat, r, scene && scene.kinkFamily);
  const isMale = (primary.gender || 'female') === 'male';
  const partnerMixed = others.length && others.some((o) => (o.gender || 'female') !== (primary.gender || 'female'));
  const partnerTags = others.length
    ? (partnerMixed
      ? (isMale ? ['1boy', '1girl', 'hetero', 'male on top'] : ['1girl', '1boy', 'hetero'])
      : (isMale ? ['2boys', 'yaoi', 'male male'] : ['2girls', 'yuri', 'two women']))
    : (isMale ? ['1boy', 'solo male'] : ['1girl', 'solo female']);
  const extraTags = [].concat(extras || []);

  const positiveParts = [
    ...ratingDef.prefix,
    ...quality,
    age,
    ...(isMale ? ['handsome male', 'adult man'] : []),
    ...style,
    ...bodyTags,
    ...sceneTags,
    ...poses,
    ...partnerTags,
    ...extraTags,
    ...anchors,
  ];

  // 负向
  const negativeParts = [
    ...BASE_NEGATIVE,
    ...MINOR_NEGATIVE,
    ...(primary.appearance.negative || []),
    ...ratingDef.negativeExtra,
  ];
  for (const c of others) negativeParts.push(...(c.appearance && c.appearance.negative ? c.appearance.negative : []));

  const positive = joinTags(positiveParts);
  const negative = joinTags(negativeParts);

  const params = {
    model: model || pcfg.checkpoint || 'auto',
    sampler: sampler || 'DPM++ 2M Karras',
    steps: steps || 30,
    cfg: cfg || (r === 'explicit' ? 6.5 : 7),
    width: width || pcfg.width || 832,
    height: height || pcfg.height || 1216,
    seed: seed != null ? seed : -1,
    clipSkip: 2,
    denoise: 0.45,
    hires: pcfg.hires || { enabled: true, scale: 1.5, denoise: 0.45 },
  };

  const out = {
    id: `${primary.id}${scene ? '-' + scene.id : ''}-h${heat}-${r}-${target}`,
    target,
    label: (TARGETS[target] || TARGETS.sdxl).label,
    character: primary.name,
    scene: scene ? `${scene.id} ${scene.title}` : null,
    heat,
    rating: r,
    positive,
    negative,
    params,
    tokenCount: { positive: positive.split(',').length, negative: negative.split(',').length },
  };

  if (target === 'midjourney') {
    out.mjCommand = buildMidjourney({ positive, params, rating: r, cast: [primary, ...others], scene });
  }
  if (target === 'novelai') {
    out.nai = buildNovelAI({ positive, negative, params, rating: r, character: primary, others, scene, heat });
  }
  if (target === 'comfyui') {
    out.workflow = buildComfyWorkflow({ positive, negative, params, batch: pcfg.comfyBatch || 4 });
  }
  if (target === 'pony') {
    out.positive = `${scorePrefix(r, heat)}, ${positive}`;
    out.negative = `score_6, score_5, score_4, ${negative}`;
  }
  if (target === 'generic' || TARGETS[target]?.plain) {
    out.markdown = buildMarkdownPack(out, primary, scene, others, rng);
  }

  return out;
}

function scorePrefix(rating, heat) {
  const map = {
    safe: 'score_9, score_8_up, score_7_up',
    suggestive: 'score_9, score_8_up, score_7_up',
    nsfw: 'score_9, score_8_up, score_7_up, rating_questionable',
    explicit: 'score_9, score_8_up, score_7_up, rating_explicit',
  };
  const base = map[rating] || map.explicit;
  return heat >= 5 ? `${base}, source_anime` : base;
}

function buildMidjourney({ positive, params, rating, cast, scene }) {
  const parts = [positive.replace(/<lora:[^>]+>/g, '').replace(/\bnsfw\b,?\s*/g, '')];
  const flags = [`--ar ${ratio(params.width, params.height)}`, `--style raw`, `--v 6.1`, `--q 2`];
  if (cast.length > 1) flags.push('--weird 0');
  const lighting = (scene && scene.camera && scene.camera.length) ? scene.camera[0] : 'cinematic lighting';
  return `${parts.join(' ')} ${lighting} ${flags.join(' ')}`.replace(/\s{2,}/g, ' ').trim();
}

function ratio(w, h) {
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function buildNovelAI({ positive, negative, params, rating, character, others, scene, heat }) {
  const prefix = rating === 'explicit' ? 'nsfw, explicit, ' : rating === 'nsfw' ? 'nsfw, ' : '';
  return {
    prompt: `${prefix}best quality, amazing quality, very aesthetic, absurdres, ${positive}`,
    negative_prompt: `${negative}, bad proportions, ai-generated`,
    steps: params.steps,
    scale: params.cfg,
    sampler: 'k_euler_ancestral',
    width: params.width,
    height: params.height,
    seed: params.seed,
    n_samples: 1,
    ucPreset: 3,
    qualityToggle: true,
    sm: false,
    sm_dyn: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    add_original_image: false,
    characterPrompts: [character, ...others].map((c) => ({
      prompt: `${c.name}: ${c.appearance.tags.slice(0, 18).join(', ')}`,
      uc: (c.appearance.negative || []).join(', '),
    })),
    vibe: scene ? { tags: scene.tags, heat } : null,
  };
}

function buildComfyWorkflow({ positive, negative, params, batch = 4 }) {
  return {
    "3": {
      "class_type": "KSampler",
      "inputs": {
        "seed": params.seed, "steps": params.steps, "cfg": params.cfg,
        "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1,
        "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
      }
    },
    "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": `${params.model}.safetensors` } },
    "5": { "class_type": "EmptyLatentImage", "inputs": { "width": params.width, "height": params.height, "batch_size": batch } },
    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": positive, "clip": ["4", 1] } },
    "7": { "class_type": "CLIPTextEncode", "inputs": { "text": negative, "clip": ["4", 1] } },
    "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
    "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "ciallo", "images": ["8", 0] } }
  };
}

function buildMarkdownPack(out, primary, scene, others, rng) {
  const L = [];
  L.push(`### ${primary.name}${scene ? ' × ' + scene.title : ''} · heat ${out.heat} · ${out.rating}`);
  L.push('');
  L.push('**正向**');
  L.push('```');
  L.push(out.positive);
  L.push('```');
  L.push('**负向**');
  L.push('```');
  L.push(out.negative);
  L.push('```');
  L.push('**参数**：' + JSON.stringify(out.params));
  if (others.length) L.push('**配角**：' + others.map((c) => `${c.name}(${c.age})`).join('、'));
  return L.join('\n');
}

/** 批量：一个角色 × 多场景 × 多目标 */
function compileBatch(opts) {
  const { character, scenes: sceneList = [], targets = ['sdxl'], heat = 4, rating = 'explicit', seedBase = 1, cast = [] } = opts;
  const out = [];
  let i = 0;
  for (const scene of sceneList.length ? sceneList : [null]) {
    for (const target of targets) {
      out.push(
        compilePrompt({
          character,
          scene,
          cast,
          heat: scene && scene.heatBase ? Math.max(heat, scene.heatBase) : heat,
          rating,
          target,
          seed: seedBase + i++,
        }),
      );
    }
  }
  return out;
}

/** 角色常驻卡：不带场景的通用提示词 */
function characterPrompt(character, { target = 'sdxl', rating = 'explicit', heat = 3, extras = [] } = {}) {
  return compilePrompt({ character, scene: null, heat, rating, target, extras });
}

/** 用散文池给场景补一条「氛围描述」，用于提示词包里的人工可读段落 */
function sceneFlavor(scene, cast, prose, { heat = 3, seed = 1 } = {}) {
  const rng = new Rng(`flavor:${seed}:${scene ? scene.id : 'none'}`);
  const scope = makeScope({ rng, heat, scene: scene || {}, cast, prose });
  const line = rng.pick((prose.pool && prose.pool.sensory) || []) || '';
  return resolve(line, scope).trim();
}

module.exports = {
  compilePrompt,
  compileBatch,
  characterPrompt,
  sceneFlavor,
  RATING_TAGS,
  BASE_NEGATIVE,
  MINOR_NEGATIVE,
  TARGETS,
};
