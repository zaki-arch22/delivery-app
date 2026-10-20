// Driver sign-up with photos, driven like a person would, against the REAL backend and the TEST database.
// Only the phone's camera is replaced (there is no camera in a test): it "takes" the made-up test picture.
import { screen, fireEvent, act } from 'expo-router/testing-library';
import { db, open, svc, loginThroughScreens, menu } from './screens';

const mockPhoto = require('fs').readFileSync(require('path').join(__dirname, '../../backend/test/fixtures/photo.jpg'));
let mockPick: 'photo' | 'denied' | 'cancel' | 'not-an-image' = 'photo';
jest.mock('../src/lib/photos', () => ({
  pickPhoto: jest.fn(async () => mockPick === 'denied' ? 'denied' : mockPick === 'cancel' ? null : { uri: 'file:///test/photo.jpg' }),
  photoBlob: jest.fn(async () => mockPick === 'not-an-image' ? new Blob([Buffer.from('<html>not a photo</html>')], { type: 'image/jpeg' }) : new Blob([mockPhoto], { type: 'image/jpeg' })),
}));

beforeAll(async () => {
  await db.query(`TRUNCATE otp_codes, sessions, notifications, device_tokens, driver_details, documents, profiles, accounts, security_events CASCADE`);
});
afterAll(async () => { await db.end(); });

async function addPhoto(kind: string, how: 'camera' | 'library' = 'camera') {
  await act(async () => { await fireEvent.press(screen.getByTestId(`${how}-${kind}`)); });
}

test('new driver: name, vehicle, three photos, send for approval -> waiting for approval', async () => {
  await open(svc());
  await loginThroughScreens('0554000001', 'driver');
  await screen.findByTestId('screen-driver-signup');

  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/first name and last name/);   // nothing typed yet
  await fireEvent.changeText(screen.getByTestId('first-input'), 'Yacine');
  await fireEvent.changeText(screen.getByTestId('last-input'), 'Rider');
  await fireEvent.changeText(screen.getByTestId('birth-input'), '31022001');
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/date of birth/);         // 31 February does not exist
  await fireEvent.changeText(screen.getByTestId('birth-input'), '12041995');
  expect(screen.getByTestId('birth-input').props.value).toBe('12/04/1995');                     // written as a date while typing
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/Choose your vehicle\./);
  await fireEvent.press(screen.getByTestId('vehicle-motorbike'));
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/colour/);
  await fireEvent.changeText(screen.getByTestId('colour-input'), 'Red');
  await fireEvent.changeText(screen.getByTestId('plate-input'), '0123-4116-16');
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/four required photos/);

  mockPick = 'denied'; await addPhoto('id_photo');
  expect(await screen.findByTestId('status-id_photo')).toHaveTextContent(/Allow camera or photo access/);
  mockPick = 'cancel'; await addPhoto('id_photo');                                            // closing the camera changes nothing
  mockPick = 'not-an-image'; await addPhoto('id_photo');
  expect(await screen.findByText(/This photo could not be read/)).toBeTruthy();                // the server refused it
  mockPick = 'photo';
  await addPhoto('id_photo');
  expect(await screen.findByText(/✓ Photo received/)).toBeTruthy();
  await addPhoto('licence_photo', 'library');
  await addPhoto('ownership_photo');
  await addPhoto('vehicle_photo');
  await fireEvent.press(screen.getByTestId('add-vehicle-photo'));                               // a second vehicle photo (the plate side)
  await addPhoto('extra-0');
  expect(await screen.findAllByText(/✓ Photo received/)).toHaveLength(5);
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/number written on your national ID card/);
  await fireEvent.changeText(screen.getByTestId('nid-input'), '1099 8877 6655 4433');      // only digits are kept
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/Accept the platform rules/);
  await fireEvent.press(screen.getByTestId('accept-rules'));

  await act(async () => { await fireEvent.press(screen.getByTestId('submit-driver')); });
  expect(await screen.findByText('Hello, Yacine Rider')).toBeTruthy();
  expect(screen.getByTestId('driver-status')).toHaveTextContent(/waiting for approval/);
  const row = await db.query(`SELECT p.status, p.display_name, d.vehicle, d.first_name, d.last_name, to_char(d.birth_date,'YYYY-MM-DD') birth, d.vehicle_color, d.plate_number, (SELECT count(*)::int FROM documents x WHERE x.profile_id=p.id) docs
    FROM profiles p JOIN driver_details d ON d.profile_id=p.id JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213554000001'`);
  expect(row.rows).toEqual([{ status: 'pending_approval', display_name: 'Yacine Rider', vehicle: 'motorbike', first_name: 'Yacine', last_name: 'Rider', birth: '1995-04-12', vehicle_color: 'Red', plate_number: '0123 4116 16', docs: 5 }]);
  expect((await db.query(`SELECT d.national_id_last3, p.rules_version FROM driver_details d JOIN profiles p ON p.id=d.profile_id JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213554000001'`)).rows).toEqual([{ national_id_last3: '433', rules_version: 1 }]);
});

test('a sender adds a driver profile from Settings (same photos flow), and keeps the sender profile', async () => {
  const s = svc();
  await open(s);
  await loginThroughScreens('0554000002', 'user');
  await fireEvent.changeText(await screen.findByTestId('name-input'), 'Sara Seller');
  await fireEvent.press(screen.getByTestId('accept-rules'));
  await fireEvent.press(screen.getByTestId('create-profile'));
  await screen.findByText('Hello, Sara Seller');
  await menu('menu-settings');
  await fireEvent.press(await screen.findByTestId('add-driver'));
  await screen.findByTestId('screen-driver-signup');
  expect(screen.getByTestId('first-input').props.value).toBe('Sara');                           // pre-filled from the name, can be changed
  expect(screen.getByTestId('last-input').props.value).toBe('Seller');
  await fireEvent.changeText(screen.getByTestId('birth-input'), '01011990');
  await fireEvent.press(screen.getByTestId('vehicle-car'));
  await fireEvent.changeText(screen.getByTestId('colour-input'), 'White');
  await fireEvent.changeText(screen.getByTestId('plate-input'), '12345 113 16');
  for (const k of ['id_photo', 'licence_photo', 'ownership_photo', 'vehicle_photo']) await addPhoto(k);
  expect(await screen.findAllByText(/✓ Photo received/)).toHaveLength(4);
  await fireEvent.changeText(screen.getByTestId('nid-input'), '109988776655');
  await fireEvent.press(screen.getByTestId('accept-rules'));
  await act(async () => { await fireEvent.press(screen.getByTestId('submit-driver')); });
  expect(await screen.findByTestId('driver-status')).toHaveTextContent(/waiting for approval/);
  const me = await s.client.call('/get_me');
  expect(me.profiles.map((p: any) => `${p.type}:${p.status}`).sort()).toEqual(['driver:pending_approval', 'user:active']);
});

test('side menu: a courier without a customer profile switches to Customer mode (creates it), and back to Courier mode', async () => {
  const s = svc();
  await open(s);
  await loginThroughScreens('0554000001', 'driver');                                   // Yacine Rider, courier only
  await menu('switch-mode');
  await screen.findByTestId('screen-add-customer');
  await fireEvent.press(screen.getByTestId('accept-rules'));
  await act(async () => { await fireEvent.press(screen.getByTestId('add-user-confirm')); });
  expect(await screen.findByTestId('send-parcel')).toBeTruthy();                       // Customer mode home: the map and "Where to?"
  await menu('switch-mode');                                                            // now both exist: a plain switch
  expect(await screen.findByTestId('driver-status')).toHaveTextContent(/waiting for approval/);
  const me = await s.client.call('/get_me');
  expect(me.active_profile.type).toBe('driver');
  expect(me.profiles.map((p: any) => p.type).sort()).toEqual(['driver', 'user']);
});
