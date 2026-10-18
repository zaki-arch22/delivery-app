import { randomInt } from 'crypto';
import { Q } from '../notify/notify';

// The parcel is with the driver: create the RETURN leg back to the sender, already picked up.
// `o` = the failed order joined with sender_name and sender_phone. Price/fees for returns are a finance rule (parked): 0 for now.
export async function createReturnLeg(q: Q, o: any, actor: { profile?: string; staff?: string }) {
  const code = String(randomInt(0, 10000)).padStart(4, '0');
  const [r] = await q(
    `INSERT INTO orders(leg, parent_order_id, user_profile_id, driver_profile_id, status, pickup_point, pickup_address, dropoff_point, dropoff_address, recipient_name, recipient_phone,
       size, vehicle, payer, cod_amount_da, pricing_version, distance_m, duration_s, recommended_da, min_da, max_da, offered_da, locked_da, delivery_code, idempotency_key, assigned_at, picked_up_at)
     VALUES ('return',$1,$2,$3,'picked_up',$4,$5,$6,$7,$8,$9,$10,$11,'sender',0,$12,$13,$14,0,0,0,0,0,$15,$16, now(), now()) RETURNING id`,
    [o.id, o.user_profile_id, o.driver_profile_id, o.dropoff_point, o.dropoff_address, o.pickup_point, o.pickup_address, o.sender_name, o.sender_phone,
     o.size, o.vehicle, o.pricing_version, o.distance_m, o.duration_s, code, `return:${o.id}`]);
  await q(`INSERT INTO order_events(order_id,type,actor_profile_id,actor_staff_id,data) VALUES ($1,'return_created',$2,$3,$4)`, [r.id, actor.profile ?? null, actor.staff ?? null, { parent: o.id }]);
  return r.id as string;
}
