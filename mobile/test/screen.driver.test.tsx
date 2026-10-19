// Driver sign-up with photos, driven like a person would, against the REAL backend and the TEST database.
// Only the phone's camera is replaced (there is no camera in a test): it "takes" the made-up test picture.
import { screen, fireEvent, act } from 'expo-router/testing-library';
import { db, open, svc, loginThroughScreens } from './screens';

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
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/name needs 2 to 60/);   // nothing typed yet
  await fireEvent.changeText(screen.getByTestId('name-input'), 'Yacine Rider');
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/Choose your vehicle\./);
  await fireEvent.press(screen.getByTestId('vehicle-motorbike'));
  await fireEvent.press(screen.getByTestId('submit-driver'));
  expect(await screen.findByTestId('signup-error')).toHaveTextContent(/Add the three photos first\./);

  mockPick = 'denied'; await addPhoto('id_photo');
  expect(await screen.findByTestId('status-id_photo')).toHaveTextContent(/Allow camera or photo access/);
  mockPick = 'cancel'; await addPhoto('id_photo');                                            // closing the camera changes nothing
  mockPick = 'not-an-image'; await addPhoto('id_photo');
  expect(await screen.findByText(/This photo could not be read/)).toBeTruthy();                // the server refused it
  mockPick = 'photo';
  await addPhoto('id_photo');
  expect(await screen.findByText(/✓ Photo received/)).toBeTruthy();
  await addPhoto('licence_photo', 'library');
  await addPhoto('vehicle_photo');
  expect(await screen.findAllByText(/✓ Photo received/)).toHaveLength(3);

  await act(async () => { await fireEvent.press(screen.getByTestId('submit-driver')); });
  expect(await screen.findByText('Hello, Yacine Rider')).toBeTruthy();
  expect(screen.getByTestId('driver-status')).toHaveTextContent(/waiting for approval/);
  const row = await db.query(`SELECT p.status, d.vehicle, (SELECT count(*)::int FROM documents x WHERE x.profile_id=p.id) docs
    FROM profiles p JOIN driver_details d ON d.profile_id=p.id JOIN accounts a ON a.id=p.account_id WHERE a.phone='+213554000001'`);
  expect(row.rows).toEqual([{ status: 'pending_approval', vehicle: 'motorbike', docs: 3 }]);
});

test('a sender adds a driver profile from Settings (same photos flow), and keeps the sender profile', async () => {
  const s = svc();
  await open(s);
  await loginThroughScreens('0554000002', 'user');
  await fireEvent.changeText(await screen.findByTestId('name-input'), 'Sara Seller');
  await fireEvent.press(screen.getByTestId('create-profile'));
  await screen.findByText('Hello, Sara Seller');
  await fireEvent.press(screen.getByTestId('open-settings'));
  await fireEvent.press(await screen.findByTestId('add-driver'));
  await screen.findByTestId('screen-driver-signup');
  expect(screen.getByTestId('name-input').props.value).toBe('Sara Seller');                   // pre-filled, can be changed
  await fireEvent.press(screen.getByTestId('vehicle-car'));
  for (const k of ['id_photo', 'licence_photo', 'vehicle_photo']) await addPhoto(k);
  expect(await screen.findAllByText(/✓ Photo received/)).toHaveLength(3);
  await act(async () => { await fireEvent.press(screen.getByTestId('submit-driver')); });
  expect(await screen.findByTestId('driver-status')).toHaveTextContent(/waiting for approval/);
  const me = await s.client.call('/get_me');
  expect(me.profiles.map((p: any) => `${p.type}:${p.status}`).sort()).toEqual(['driver:pending_approval', 'user:active']);
});
