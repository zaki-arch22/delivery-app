// Test helper for the proof chain: the driver's pickup needs the SENDER's pickup code, a parcel photo and the phone's
// position; delivery needs the receiver's code and the position. The values are read through the sender's own view of the
// order (as in real life: the sender shows the code), using each test file's own request function.
type Api = (path: string, body?: any, token?: string) => Promise<{ s: number; b: any }>;
export function proof(api: Api, photo: (driverToken: string) => Promise<string>) {
  const view = async (orderId: string, senderToken: string) => (await api('/get_order?id=' + orderId, undefined, senderToken)).b;
  return {
    view,
    async pickup(orderId: string, senderToken: string, driverToken: string, over: any = {}) {
      const o = await view(orderId, senderToken);
      return api('/update_job_step', { order_id: orderId, step: 'picked_up', pickup_code: o.pickup_code, parcel_photo: await photo(driverToken), location: { lat: o.pickup_lat, lng: o.pickup_lng }, ...over }, driverToken);
    },
    async deliver(orderId: string, senderToken: string, driverToken: string, over: any = {}) {
      const o = await view(orderId, senderToken);
      return api('/update_job_step', { order_id: orderId, step: 'delivered', delivery_code: o.delivery_code, location: { lat: o.dropoff_lat, lng: o.dropoff_lng }, ...over }, driverToken);
    },
    // Where the drop-off is (for delivery steps that set their own code).
    async dropoff(orderId: string, senderToken: string) { const o = await view(orderId, senderToken); return { lat: o.dropoff_lat, lng: o.dropoff_lng }; },
  };
}
