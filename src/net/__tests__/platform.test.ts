// Библиотека TCP отдаёт module.exports без .default — getNet() должен взять сам модуль.
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('react-native-tcp-socket', () => ({ createServer: () => ({}), createConnection: () => ({}) }));

test('сетевой модуль берётся и без export default', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNet } = require('../platform');
  const net = getNet();
  expect(typeof net.createServer).toBe('function');
  expect(typeof net.createConnection).toBe('function');
});
