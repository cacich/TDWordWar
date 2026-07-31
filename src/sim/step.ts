/**
 * 每個模擬步的推進。固定步長 1/60 秒由 core/loop.ts 呼叫。
 * 此檔不可 import render/DOM。
 */
import { ENEMY_BY_KEY } from '../data/enemies'
import { beginBattle } from './actions'
import { stepBondSkills } from './bonds'
import { SLOW_FACTOR, damageEnemy, enemyPos, pushEffect, stepCombat, stepEffects } from './combat'
import { unitIncome, waveIncome } from './economy'
import { stepSkills } from './skills'
import { emit } from './events'
import { PREP_SECONDS, enemyBaseHp } from './waves'
import type { Enemy, GameState } from './types'

export function stepGame(state: GameState, dt: number): void {
  if (state.phase === 'won' || state.phase === 'lost') return
  state.time += dt

  if (state.phase === 'prep') {
    state.prepTimer -= dt
    if (state.prepTimer <= 0) beginBattle(state)
    stepEffects(state, dt)
    return
  }

  state.waveTime += dt
  for (const u of state.units) if (u.atkFlash > 0) u.atkFlash -= dt
  spawnDue(state)
  stepFrenzy(state, dt)
  stepStatuses(state, dt)
  stepEnemySupport(state, dt)
  moveEnemies(state, dt)
  stepCombat(state, dt)
  stepSkills(state, dt)
  stepBondSkills(state, dt)
  stepMeteor(state, dt)
  stepEffects(state, dt)
  cleanupDead(state)
  checkWaveEnd(state)
}

/**
 * 流星火雨（局外道具「流星火雨」）：戰鬥中每隔一段時間，對最前方那群敵人降下火球。
 * 傷害綁在 enemyBaseHp 上，才能跟著波次的指數血量一起成長、後期不失效。
 */
function stepMeteor(state: GameState, dt: number): void {
  if (state.perks.meteorInterval <= 0) return
  state.meteorTimer -= dt
  if (state.meteorTimer > 0) return
  state.meteorTimer += state.perks.meteorInterval

  const alive = state.enemies.filter((e) => e.hp > 0)
  if (!alive.length) return
  let front = alive[0]
  for (const e of alive) if (e.dist > front.dist) front = e
  const c = enemyPos(state.board, front)
  const dmg = 0.7 * enemyBaseHp(state.wave, state.maxWave, state.arc) * state.hpMul
  for (const e of alive) {
    const p = enemyPos(state.board, e)
    if (Math.hypot(p.x - c.x, p.y - c.y) > 1.5) continue
    damageEnemy(state, e, dmg)
    if (e.hp > 0) {
      e.burnT = Math.max(e.burnT, 3)
      e.burnDps = Math.max(e.burnDps, dmg * 0.12)
    }
  }
  emit(state, { kind: 'skill', name: '流星火雨', x: c.x, y: c.y })
  pushEffect(state.effects, { kind: 'splash', fromX: c.x, fromY: c.y, toX: c.x, toY: c.y, life: 0.35, maxLife: 0.35, fx: 'fire' })
  pushEffect(state.effects, { kind: 'ring', fromX: c.x, fromY: c.y, toX: c.x + 1.5, toY: c.y, life: 0.35, maxLife: 0.35, color: '#c8502a' })
}

/** 依敵表建立一隻執行期敵人。分裂出的小怪也走這裡，避免欄位漏填 */
function makeEnemy(state: GameState, defKey: string, hp: number, dist = 0): Enemy {
  const def = ENEMY_BY_KEY[defKey]
  return {
    id: state.nextEnemyId++,
    defKey: def.key,
    char: def.char,
    hp,
    maxHp: hp,
    def: def.def,
    speed: def.speed,
    flying: def.flying,
    bounty: def.bounty,
    damage: def.damage,
    troop: def.troop,
    ccImmune: def.ccImmune ?? false,
    burnImmune: def.burnImmune ?? false,
    slowImmune: def.slowImmune ?? false,
    dist,
    hitFlash: 0,
    slow: 0,
    stun: 0,
    vuln: 0,
    burnT: 0,
    burnDps: 0,
  }
}

function spawnDue(state: GameState): void {
  while (state.spawnQueue.length && state.spawnQueue[0].at <= state.waveTime) {
    const entry = state.spawnQueue.shift()!
    state.enemies.push(makeEnemy(state, entry.defKey, entry.hp))
  }
}

/**
 * ★ 督戰：這一波**一定會結束**的最後保證。
 *
 * 卡波（整局停在同一波動不了）需要兩件事同時成立，而且它們會互相加乘：
 *   1. **打不死**——一群妖道互相回血（已由下面 stepEnemySupport 的三條規則根治）
 *   2. **推不動**——擊退與定身把敵人壓在原地，於是它們也走不到大營、不會漏過去結束這一波
 * 規則 1 讓「打不死」變得很難發生，但**只要玩家的擊退夠強，光靠 2 就能無限拖住**，
 * 所以這裡再加一道與成因無關的保險：僵住夠久就讓賊軍「督戰」。
 *
 * 判定看的是「**有沒有進展**」而不是「花了多久」——慢慢推進的長波次是正常的（後期一波
 * 本來就可能超過 90 秒）。進展有三個訊號，任何一個動了就不算僵局：
 *   1. 最前方的敵人推進了（高水位）
 *   2. 有人死了（`stats.kills` 變了）
 *   3. 場上總血量掉了 `HP_PROGRESS` 以上（低水位）
 * 第 3 個是為了不誤傷「控住一隻高血敵人慢慢磨」的正當打法：那時沒人死、也沒人前進，
 * 但血量確實在掉。反過來，妖道回血追平輸出的僵局裡，總血量的低水位就是推不動的。
 *
 * 連續 `STALL_GRACE` 秒三個訊號都沒動就開始爬 frenzy，`FRENZY_RAMP` 秒爬到滿：
 * 回血光環歸零、敵速 ×`FRENZY_SPEED_MUL`、定身與擊退失效 —— 敵人必定走到大營。
 *
 * ⚠ frenzy 在一波之內**只升不降**（只在過波與清場時歸零）。曾經讓它「一有進展就回退」，
 *   結果是擊退鎖進入穩定的震盪：frenzy 一掉，擊退立刻又把敵人推回去，
 *   於是敵人以極慢的速度來回爬，波次照樣結束不了。督戰令一旦下達就不收回，才是真的保證。
 */
const STALL_GRACE = 8
const FRENZY_RAMP = 6
/** 總血量要掉多少比例才算「有在推進」 */
const HP_PROGRESS = 0.005
/** frenzy = 1 時的敵速倍率 */
export const FRENZY_SPEED_MUL = 3

function stepFrenzy(state: GameState, dt: number): void {
  let front = 0
  let totalHp = 0
  let alive = 0
  for (const e of state.enemies) {
    if (e.hp <= 0) continue
    alive++
    totalHp += e.hp
    if (e.dist > front) front = e.dist
  }

  // 還在出怪＝這一波本來就還沒開始收尾；場上沒人＝馬上要過波。兩者都不算僵局，
  // 但**必須同步水位**，否則上一波留下的紀錄會讓新的一波一開始就被判成沒進展。
  if (state.spawnQueue.length || !alive) {
    state.stallT = 0
    state.stallMark = front
    state.stallKills = state.stats.kills
    state.stallHp = totalHp
    if (!alive) state.frenzy = 0
    return
  }

  const progressed =
    front > state.stallMark + 0.02 ||
    state.stats.kills !== state.stallKills ||
    totalHp <= state.stallHp * (1 - HP_PROGRESS)
  if (progressed) {
    state.stallMark = Math.max(state.stallMark, front)
    state.stallKills = state.stats.kills
    state.stallHp = Math.min(state.stallHp, totalHp)
    state.stallT = 0
    return
  }
  // ⚠ 沒有進展的幀**不可以**把水位往下修。曾經每幀都跟著 totalHp 下修，
  //   於是「每幀掉一點點」的血量永遠追不上 HP_PROGRESS 這個門檻——
  //   水位被自己拉著走，磨血的正當打法照樣被判成僵局。

  state.stallT += dt
  if (state.stallT < STALL_GRACE) return
  if (state.frenzy === 0) emit(state, { kind: 'frenzy' })
  state.frenzy = Math.min(1, state.frenzy + dt / FRENZY_RAMP)
}

/**
 * 敵方的支援行為：妖道系的回血光環、旗賊系的加防／加速光環、BOSS 的自我再生。
 * 全部以「最大血量／敵表基準值的比例」計算，才能跟著波次的指數血量一起成長、後期不失效。
 * 放在 stepStatuses（灼燒）之後，讓灼燒與回血在同一幀正面對撞。
 *
 * ★ 敵方光環的疊加上限 —— 這一段是「卡波」的根治處。三條規則缺一不可：
 *
 *   1. **治療者之間不互相治療**。N 隻妖道互奶時，每一隻收到的是 (N−1)×hps，
 *      隨數量**平方**成長：6 隻疊在一起就是每秒回 25% 血，任何輸出都追不上，
 *      於是整包妖道變成打不死的鐵板。妖道本身很脆（hpMul 0.8 / def 5），
 *      只要沒人奶它就殺得掉，「優先集火解決」這個設計意圖才回得來。
 *   2. **總回血有上限**（`HEAL_CAP_HPS`）。妖道多的意義因此是「覆蓋更廣、比較難一次拔掉」，
 *      而不是「回血無限疊」。上限也讓波次組成的 `maxShare` 只是第二道防線而非唯一防線。
 *   3. **加防光環同樣有上限**（`DEF_ADD_CAP`），理由與 2 完全一樣。
 *
 * 整段再乘上 (1 − frenzy)：僵持太久時督戰會直接關掉敵方的續航（見 stepFrenzy）。
 */
export const HEAL_CAP_HPS = 0.12
export const DEF_ADD_CAP = 60
/** 加速光環的疊加上限（倍率） */
export const SPEED_AURA_CAP = 1.8

/**
 * 光環累加用的暫存區。模組層重用而不是每幀 new，是為了省電（見 CLAUDE.md 的「省電」節）；
 * 只在單次 stepEnemySupport 呼叫內有意義，不跨幀保存任何狀態，因此不影響決定性。
 */
let healAcc = new Float64Array(0)
let defAcc = new Float64Array(0)
let speedAcc = new Float64Array(0)

function stepEnemySupport(state: GameState, dt: number): void {
  const auraMul = 1 - state.frenzy
  const list = state.enemies
  let sources = 0

  for (const e of list) {
    if (e.hp <= 0) continue
    const def = ENEMY_BY_KEY[e.defKey]
    if (def.regen) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * def.regen * auraMul * dt)
    // ⚠ def / speed 是「每幀從敵表重算」的衍生值（見 types.ts 的 Enemy），
    //   光環才不會逐幀累積成天文數字，舊存檔載入後也會在第一幀自動修正。
    e.def = def.def
    e.speed = def.speed
    if (def.healAura || def.buffAura) sources++
  }
  if (!sources || auraMul <= 0) return

  if (healAcc.length < list.length) {
    healAcc = new Float64Array(list.length)
    defAcc = new Float64Array(list.length)
    speedAcc = new Float64Array(list.length)
  } else {
    healAcc.fill(0, 0, list.length)
    defAcc.fill(0, 0, list.length)
    speedAcc.fill(0, 0, list.length)
  }

  // 以「來源 → 受影響者」的方向掃：光環來源通常只有幾隻，比每隻敵人都重掃全場便宜得多
  for (let s = 0; s < list.length; s++) {
    const src = list[s]
    if (src.hp <= 0) continue
    const sdef = ENEMY_BY_KEY[src.defKey]
    const heal = sdef.healAura
    const buff = sdef.buffAura
    if (!heal && !buff) continue
    const c = enemyPos(state.board, src)
    for (let t = 0; t < list.length; t++) {
      if (t === s) continue
      const e = list[t]
      if (e.hp <= 0) continue
      const p = enemyPos(state.board, e)
      const d = Math.hypot(p.x - c.x, p.y - c.y)
      // 規則 1：治療者不治療其他治療者
      if (heal && d <= heal.radius && !ENEMY_BY_KEY[e.defKey].healAura) healAcc[t] += heal.hps
      if (buff && d <= buff.radius) {
        defAcc[t] += buff.defAdd ?? 0
        speedAcc[t] += (buff.speedMul ?? 1) - 1
      }
    }
  }

  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (e.hp <= 0) continue
    if (healAcc[i] > 0 && e.hp < e.maxHp) {
      const hps = Math.min(healAcc[i], HEAL_CAP_HPS) * auraMul
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * hps * dt)
    }
    if (defAcc[i] > 0) e.def += Math.min(defAcc[i], DEF_ADD_CAP) * auraMul
    if (speedAcc[i] > 0) e.speed *= 1 + Math.min(speedAcc[i], SPEED_AURA_CAP - 1) * auraMul
  }
}

/** 控場狀態倒數與持續傷害。在移動之前跑，定身當幀就生效 */
function stepStatuses(state: GameState, dt: number): void {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue
    if (e.hitFlash > 0) e.hitFlash -= dt
    if (e.slow > 0) e.slow -= dt
    if (e.stun > 0) e.stun -= dt
    if (e.vuln > 0) e.vuln -= dt
    if (e.burnT > 0) {
      e.burnT -= dt
      damageEnemy(state, e, e.burnDps * dt)
      if (e.burnT <= 0) e.burnDps = 0
    }
  }
}

function moveEnemies(state: GameState, dt: number): void {
  const goal = state.board.path.length - 1
  // 沼澤泥沼（道具）× 戰場特性 × 督戰。三者都是中性值 1 起跳，各自獨立
  const globalMul =
    state.perks.enemySpeedMul *
    (state.mods.enemySpeedMul ?? 1) *
    (1 + state.frenzy * (FRENZY_SPEED_MUL - 1))
  for (const e of state.enemies) {
    if (e.hp <= 0) continue
    if (e.stun > 0) continue // 定身中不前進
    const slowMul = e.slow > 0 ? SLOW_FACTOR : 1
    e.dist += e.speed * slowMul * globalMul * dt
    if (e.dist >= goal) {
      e.hp = 0
      e.dist = goal
      state.stats.leaks++
      emit(state, { kind: 'leak' })
      // 回魂旗：機率不扣血命，敵人依然算漏過（stats.leaks 照計）
      if (state.rng() >= state.perks.leakBlockChance) {
        state.lives -= e.damage
        if (state.lives <= 0) {
          state.lives = 0
          state.phase = 'lost'
          emit(state, { kind: 'lost' })
        }
      }
    }
  }
}

/**
 * 移除死亡敵人，並處理死亡分裂。
 *
 * ⚠ 分裂**必須**在這裡做，不能在傷害來源那邊直接 push：
 *   stepCombat／stepStatuses 都在迭代 state.enemies，當場新增會造成
 *   「剛分裂出來的小怪在同一幀又被打死再分裂」的連鎖。
 *   這裡是每幀唯一一次、且在所有傷害結算之後的安全點。
 *   **允許多層分裂**（分裂將 → 分裂賊 → 蟻賊）：子代死亡是在後續的幀才結算，
 *   每一層都各自走過一次完整的傷害流程，所以不會在同一幀爆炸性增殖。
 *   安全性靠「分裂圖必須是無環的有限圖」保證——蟻賊沒有 splitInto，鏈一定終止。
 *   ⚠ 新增 splitInto 時**絕對不能形成環**（A→B→A 會無限增殖）；
 *   enemies-ext.test.ts 有測試驗證分裂圖無環。
 */
function cleanupDead(state: GameState): void {
  if (!state.enemies.some((e) => e.hp <= 0)) return

  const born: Enemy[] = []
  for (const e of state.enemies) {
    if (e.hp > 0) continue
    const split = ENEMY_BY_KEY[e.defKey].splitInto
    // 漏過大營的敵人（dist 已到終點）不該再分裂，否則會在終點刷出一批必漏的小怪
    if (!split || e.dist >= state.board.path.length - 1) continue
    const childDef = ENEMY_BY_KEY[split.key]
    if (!childDef) continue
    // 子代血量以「母體出生血量」換算，才會跟著波次成長；沿路徑稍微散開避免完全重疊
    const childHp = Math.max(1, Math.round((e.maxHp / ENEMY_BY_KEY[e.defKey].hpMul) * childDef.hpMul))
    for (let i = 0; i < split.count; i++) {
      born.push(makeEnemy(state, split.key, childHp, Math.max(0, e.dist - i * 0.25)))
    }
  }

  state.enemies = state.enemies.filter((e) => e.hp > 0)
  for (const b of born) state.enemies.push(b)
}

function checkWaveEnd(state: GameState): void {
  /**
   * 這一幀剛剛落敗——**最後一隻敵人漏過大營並打光生命**時，`moveEnemies` 已經把
   * phase 設成 'lost'，但場上與隊列同時清空了，於是下面的過波結算會把它覆寫回 'prep'，
   * 玩家在 0 生命的狀態下繼續打（結算畫面與聲望也都不會出現）。
   * 無盡模式讓這個縫隙變得致命：那裡沒有通關出口，落敗是唯一的結束方式。
   */
  if (state.phase === 'lost') return
  if (state.spawnQueue.length || state.enemies.length) return
  // 糧道暢通：固定收入 ×incomeMul（產糧不受影響）
  state.lastIncome = {
    base: Math.round(waveIncome(state.wave) * state.perks.incomeMul),
    units: unitIncome(state),
  }
  state.food += state.lastIncome.base + state.lastIncome.units
  // ⚠ 無盡模式的 maxWave 是 Infinity，這個條件永遠不成立——無盡只能被打敗、不會通關，
  //   所以下面的過波流程（回血、事件、進佈陣）就是它唯一的出口。刻意不寫成
  //   `Number.isFinite(...) &&`：多一個條件反而讓人以為無盡走的是另一條分支。
  if (state.wave >= state.maxWave) {
    state.phase = 'won'
    emit(state, { kind: 'won' })
    return
  }
  // 杏林春暖：每通過 N 波回 1 生命（以剛清掉的這一波計）
  if (
    state.perks.healEveryWaves > 0 &&
    state.wave % state.perks.healEveryWaves === 0 &&
    state.lives < state.maxLives
  ) {
    state.lives = Math.min(state.maxLives, state.lives + 1)
  }
  emit(state, { kind: 'waveClear', wave: state.wave })
  state.wave++
  state.recruitsThisWave = 0
  state.phase = 'prep'
  state.prepTimer = PREP_SECONDS
}
