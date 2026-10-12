import Decimal from 'decimal.js';
import { z } from 'zod';
import type { CostLine, Dataset, Sale, SaleInput } from './types';
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const D = (value: string | number) => new Decimal(value);
export const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export function todaySeoul() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(k => p.find(x => x.type === k)!.value).join('-');
}
const amount = z.string().refine(s => /^\d+(\.\d+)?$/.test(s) && D(s).isFinite() && D(s).gte(0), '0 이상의 금액을 입력해 주세요.');
const inputSchema = z.object({ date: z.string().refine(validDate, '올바른 날짜를 입력해 주세요.'), menu_id: z.string().min(1, '메뉴를 선택해 주세요.'), channel: z.enum(['매장', '포장']), quantity: z.string().refine(s => /^\d+$/.test(s) && D(s).gt(0) && D(s).lte(Number.MAX_SAFE_INTEGER), '수량은 1 이상의 정수로 입력해 주세요.'), unit_price: amount, discount_amount: amount, payment_fee: amount });
export function costFor(data: Dataset, input: SaleInput): { food: string; packaging: string; basis: CostLine[]; version: string } {
  const menu = data.menus.find(m => m.menu_id === input.menu_id);
  if (!menu) throw Error('선택한 메뉴가 없습니다.');
  const recipes = data.recipes.filter(r => r.menu_id === menu.menu_id && r.recipe_version === menu.recipe_version && (!r.channel_only || r.channel_only === input.channel));
  if (!recipes.length) throw Error('적용할 레시피가 없어 저장할 수 없습니다.');
  let food = D(0), packaging = D(0);
  const basis = recipes.map(r => {
    const material = data.materials.find(m => m.material_id === r.material_id);
    if (!material || material.unit !== r.unit || !/^\d+(\.\d+)?$/.test(r.quantity)) throw Error('재료 단위·사용량을 확인해 주세요.');
    const prices = data.price_history.filter(p => p.material_id === r.material_id && p.effective_date <= input.date).sort((a,b) => b.effective_date.localeCompare(a.effective_date));
    const p = prices[0];
    if (!p || (prices[1] && prices[1].effective_date === p.effective_date) || p.pack_price == null || p.pack_quantity == null || !D(p.pack_price).isFinite() || D(p.pack_price).lt(0) || !D(p.pack_quantity).gt(0)) throw Error(`${material.name}: 판매일의 가격 근거가 없거나 모호합니다.`);
    const cost = D(p.pack_price).div(p.pack_quantity).mul(r.quantity);
    const isPackaging = r.channel_only === '포장';
    if (isPackaging) packaging = packaging.plus(cost); else food = food.plus(cost);
    return { material_id: r.material_id, name: material.name, quantity: r.quantity, unit: r.unit, effective_date: p.effective_date, pack_price: p.pack_price, pack_quantity: p.pack_quantity, cost: cost.toString(), packaging: isPackaging };
  });
  return { food: food.toString(), packaging: packaging.toString(), basis, version: menu.recipe_version };
}
export function prepareSale(data: Dataset, input: SaleInput, id: string, previous?: Sale, today = todaySeoul()): Sale {
  const checked = inputSchema.safeParse(input);
  if (!checked.success) throw Error(checked.error.issues.map(i => `${({date:'판매일',quantity:'수량',unit_price:'실제 단가',discount_amount:'전체 할인',payment_fee:'전체 수수료',menu_id:'메뉴'} as Record<string,string>)[String(i.path[0])] || '입력'}: ${i.message}`).join('\n'));
  if (input.date > today) throw Error('미래 날짜의 판매는 저장할 수 없습니다.');
  if (!data.menus.some(m => m.menu_id === input.menu_id)) throw Error('선택한 메뉴가 없습니다.');
  const duplicate = data.sales.find(s => s.sale_id !== id && s.date === input.date && s.menu_id === input.menu_id && s.channel === input.channel);
  if (duplicate) throw Error('같은 날짜·메뉴·채널의 판매가 있습니다. 기존 기록을 수정해 주세요.');
  const net = D(input.quantity).mul(input.unit_price).minus(input.discount_amount);
  if (net.lt(0)) throw Error('전체 할인은 할인 전 판매금액보다 클 수 없습니다.');
  const sameBasis = previous && previous.date === input.date && previous.menu_id === input.menu_id && previous.channel === input.channel;
  const cost = sameBasis ? { food: previous.unit_food_cost_snapshot, packaging: previous.unit_packaging_cost_snapshot, version: previous.recipe_version, basis: previous.cost_basis } : costFor(data, input);
  if (cost.food == null || cost.packaging == null) throw Error('당시 원가 근거가 없어 저장할 수 없습니다.');
  return { ...previous, sale_id: id, ...input, quantity: D(input.quantity).toString(), unit_price: D(input.unit_price).toString(), discount_amount: D(input.discount_amount).toString(), payment_fee: D(input.payment_fee).toString(), net_sales: net.toString(), unit_food_cost_snapshot: cost.food, unit_packaging_cost_snapshot: cost.packaging, recipe_version: cost.version, ...(cost.basis ? { cost_basis: cost.basis } : {}) };
}
export function saleAmounts(s: Sale) {
  const net = D(s.net_sales), qty = D(s.quantity);
  const missing = s.unit_food_cost_snapshot == null || s.unit_packaging_cost_snapshot == null || s.payment_fee == null;
  const food = s.unit_food_cost_snapshot == null ? null : D(s.unit_food_cost_snapshot).mul(qty);
  const packaging = s.unit_packaging_cost_snapshot == null ? null : D(s.unit_packaging_cost_snapshot).mul(qty);
  const cost = food && packaging ? food.plus(packaging) : null;
  const fee = s.payment_fee == null ? null : D(s.payment_fee);
  const profit = missing ? null : net.minus(cost!).minus(fee!);
  const mismatch = !qty.mul(s.unit_price).minus(s.discount_amount).eq(net);
  return { net, qty, food, packaging, cost, fee, profit, mismatch, rate: profit && !net.isZero() ? profit.div(net).mul(100) : null };
}
export function totals(sales: Sale[]) {
  let net = D(0), qty = D(0), food = D(0), packaging = D(0), fee = D(0), knownProfit = D(0), missing = 0, mismatches = 0;
  for (const s of sales) { const a = saleAmounts(s); net = net.plus(a.net); qty = qty.plus(a.qty); if(a.food) food=food.plus(a.food); if(a.packaging) packaging=packaging.plus(a.packaging); if(a.fee) fee=fee.plus(a.fee); if(a.profit) knownProfit=knownProfit.plus(a.profit); else missing++; if(a.mismatch) mismatches++; }
  const profit = missing ? null : knownProfit;
  return { net, qty, food, packaging, cost: food.plus(packaging), fee, profit, knownProfit, missing, mismatches, rate: profit && !net.isZero() ? profit.div(net).mul(100) : null, average: qty.isZero() ? null : net.div(qty) };
}
export function money(value: Decimal | string | null | undefined) { return value == null ? '확인 불가' : D(value instanceof Decimal ? value.toString() : value).toDecimalPlaces(0).toNumber().toLocaleString('ko-KR') + '원'; }
export function percent(value: Decimal | null) { return value == null ? '—' : value.toFixed(1) + '%'; }
