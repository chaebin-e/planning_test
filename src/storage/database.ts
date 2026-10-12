import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { D, prepareSale, validDate } from '../domain/sales';
import type { Dataset, Row, Sale, SaleInput, Snapshot } from '../domain/types';
export const names = ['suppliers','materials','menus','recipes','price_history','calendar','sales','opening_inventory','inventory_events','expenses','monthly_expense_plan'] as const;
type Stored = Row & { _key: string };
type Meta = { key: string; initialized: boolean; revision: number; source: Row; settings: Row; calculationVersion: string };
const idFields: Record<string,string> = { suppliers:'supplier_id', materials:'material_id', menus:'menu_id', calendar:'date', sales:'sale_id', opening_inventory:'material_id', inventory_events:'event_id', expenses:'expense_id' };
const dateSchema = z.string().refine(validDate);
const nonnegative = z.string().refine(s => /^\d+(\.\d+)?$/.test(s) && D(s).isFinite() && D(s).gte(0));
const nullableMoney = nonnegative.nullable();
const base = z.object({}).passthrough();
const schemas: Record<string,z.ZodType> = {
  menus: z.object({menu_id:z.string().min(1),name:z.string().min(1),price:nonnegative,recipe_version:z.string().min(1),category:z.string()}).passthrough(),
  materials:z.object({material_id:z.string().min(1),name:z.string(),unit:z.enum(['g','ml','개']),pack_quantity:nonnegative.refine(s=>D(s).gt(0))}).passthrough(),
  recipes:z.object({menu_id:z.string(),material_id:z.string(),recipe_version:z.string(),quantity:nonnegative,unit:z.enum(['g','ml','개']),channel_only:z.enum(['매장','포장']).optional()}).passthrough(),
  price_history:z.object({material_id:z.string(),effective_date:dateSchema,pack_price:nonnegative,pack_quantity:nonnegative.refine(s=>D(s).gt(0))}).passthrough(),
  calendar:z.object({date:dateSchema,is_open:z.boolean(),record_complete:z.boolean()}).passthrough(),
  sales:z.object({sale_id:z.string().min(1),date:dateSchema,menu_id:z.string(),channel:z.enum(['매장','포장']),quantity:nonnegative.refine(s=>D(s).isInteger()&&D(s).gt(0)),unit_price:nonnegative,discount_amount:nonnegative,net_sales:nonnegative,payment_fee:nullableMoney,unit_food_cost_snapshot:nullableMoney,unit_packaging_cost_snapshot:nullableMoney,recipe_version:z.string()}).passthrough(),
  suppliers:z.object({supplier_id:z.string().min(1),name:z.string()}).passthrough(),
  opening_inventory:z.object({material_id:z.string(),date:dateSchema,quantity:nonnegative,unit:z.enum(['g','ml','개'])}).passthrough(),
  inventory_events:z.object({event_id:z.string().min(1),date:dateSchema,material_id:z.string(),quantity:z.string().refine(s=>new RegExp('^-?\\d+(\\.\\d+)?$').test(s)),event_type:z.enum(['입고','폐기','실사조정']),unit:z.enum(['g','ml','개'])}).passthrough(),
  expenses:z.object({expense_id:z.string().min(1),date:dateSchema,category:z.string(),amount:nonnegative}).passthrough(),
  monthly_expense_plan:z.object({month:z.string().regex(/^\d{4}-\d{2}$/),category:z.string(),amount:nonnegative}).passthrough()
};
function normalize(value: unknown): unknown {
  if (typeof value === 'number') { if(!Number.isFinite(value)) throw Error('유한하지 않은 숫자가 있습니다.'); return String(value); }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalize(v)]));
  return value;
}
export function validateSource(raw: unknown): Dataset {
  const root = z.object({meta:base,settings:base}).passthrough().parse(normalize(raw));
  const data = root as unknown as Dataset;
  for (const name of names) {
    const rows = z.array(schemas[name] || base).parse(root[name]) as Row[];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = String(idFields[name] ? row[idFields[name]] : name === 'price_history' ? `${row.material_id}:${row.effective_date}` : name === 'recipes' ? `${row.menu_id}:${row.recipe_version}:${row.material_id}:${row.channel_only || ''}` : `${row.month}:${row.category}`);
      if(seen.has(key)) throw Error(`${name}: 중복 식별번호 또는 기준이 있습니다.`); seen.add(key);
    }
    (data as unknown as Row)[name] = rows;
  }
  const menuIds = new Set(data.menus.map(m=>m.menu_id)), materialIds = new Set(data.materials.map(m=>m.material_id));
  const suppliers = new Set((data.suppliers as Row[]).map(s=>s.supplier_id));
  for (const row of [...data.sales, ...data.recipes]) if(!menuIds.has(row.menu_id)) throw Error('없는 메뉴를 참조하는 기록입니다.');
  for (const row of [...data.recipes,...data.price_history,...data.opening_inventory as Row[],...data.inventory_events as Row[]]) if(!materialIds.has(String(row.material_id))) throw Error('없는 재료를 참조하는 기록입니다.');
  for (const row of data.materials as unknown as Row[]) if(!suppliers.has(row.supplier_id)) throw Error('없는 공급사를 참조하는 재료입니다.');
  const saleKeys = new Set<string>();
  for (const s of data.sales) { const k=`${s.date}:${s.menu_id}:${s.channel}`; if(saleKeys.has(k)) throw Error('판매 하루 합계가 중복됩니다.'); saleKeys.add(k); }
  return data;
}
export class CafeDB extends Dexie {
  appMeta!: Table<Meta,string>;
  constructor(name = 'prep-cafe-operations-v1') {
    super(name);
    const stores: Record<string,string> = { appMeta:'key' };
    for(const n of names) stores[n] = '_key,date,menu_id,material_id';
    stores.sales += ',[date+menu_id+channel]';
    this.version(1).stores(stores);
  }
}
export const db = new CafeDB();
async function locked<T>(action: () => Promise<T>): Promise<T> {
  if(typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('prep-cafe-write', action);
  return action(); // Node test runtime; browser UI prevents unsupported writes.
}
export async function seed(database: CafeDB, source: Dataset) {
  return locked(() => database.transaction('rw',database.tables,async()=>{
    if((await database.appMeta.get('state'))?.initialized) return;
    for(const n of names) {
      if(await database.table(n).count()) throw Error('초기화 표시가 없는 기존 자료가 있습니다. 덮어쓰지 않습니다.');
      const rows = source[n] as Row[];
      await database.table(n).bulkAdd(rows.map((r,i)=>({...r,_key:String(idFields[n] ? r[idFields[n]] : `${n}:${i}`)})));
    }
    await database.appMeta.add({key:'state', initialized:true,revision:0,source:source.meta,settings:source.settings as Row, calculationVersion:'epic1-approved-20261012'});
  }));
}
export async function initialize(database = db) {
  if((await database.appMeta.get('state'))?.initialized) return;
  const response = await fetch('/sample/store-operations.json');
  if(!response.ok) throw Error('가상 샘플을 불러오지 못했습니다. 다시 시도해 주세요.');
  const data = validateSource(await response.json());
  await seed(database,data);
}
export async function readSnapshot(database = db): Promise<Snapshot> {
  return database.transaction('r',database.tables,async()=>{
    const meta=await database.appMeta.get('state');
    if(!meta?.initialized) throw Error('저장 자료 준비가 완료되지 않았습니다.');
    const data: Row = {meta:meta.source,settings:meta.settings};
    for(const n of names) data[n]=(await database.table(n).toArray() as Stored[]).map(({_key:_,...r})=>r);
    return {data:data as Dataset,revision:meta.revision};
  });
}
export async function saveSale(input: SaleInput, id: string, expectedRevision: number, previous?: Sale, database = db) {
  const snapshot=await readSnapshot(database);
  if(snapshot.revision !== expectedRevision) throw Error('다른 창에서 기록이 변경됐습니다. 창을 닫고 최신 기록을 확인해 주세요.');
  const existing=snapshot.data.sales.find(s=>s.sale_id===id);
  if(previous && !existing) throw Error('이미 삭제된 판매입니다. 최신 목록을 확인해 주세요.');
  const prepared=prepareSale(snapshot.data,input,id,previous ? existing : undefined);
  await locked(()=>database.transaction('rw',database.table('sales'),database.appMeta,async()=>{
    const meta=(await database.appMeta.get('state'))!;
    if(meta.revision!==expectedRevision) throw Error('다른 창에서 기록이 변경됐습니다. 최신 기록을 확인해 주세요.');
    if(previous) await database.table('sales').put({...prepared,_key:id});
    else await database.table('sales').add({...prepared,_key:id});
    await database.appMeta.put({...meta,revision:meta.revision+1});
  }));
  return prepared;
}
export async function deleteSale(id: string, expectedRevision: number, database = db) {
  await locked(()=>database.transaction('rw',database.table('sales'),database.appMeta,async()=>{
    const meta=(await database.appMeta.get('state'))!;
    if(meta.revision!==expectedRevision) throw Error('다른 창에서 기록이 변경됐습니다. 최신 목록을 확인해 주세요.');
    if(!await database.table('sales').get(id)) throw Error('이미 삭제된 판매입니다.');
    await database.table('sales').delete(id);
    await database.appMeta.put({...meta,revision:meta.revision+1});
  }));
}
