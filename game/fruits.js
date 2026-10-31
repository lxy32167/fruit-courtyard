export const FRUITS = [
  { name: '樱桃', radius: 17, color: '#d95c53' },
  { name: '蓝莓', radius: 21, color: '#7d99d2' },
  { name: '青柠', radius: 25, color: '#bbd83b' },
  { name: '葡萄', radius: 31, color: '#a366df' },
  { name: '橙子', radius: 38, color: '#ffae42' },
  { name: '苹果', radius: 46, color: '#8fc848' },
  { name: '桃子', radius: 57, color: '#f59fba' },
  { name: '椰子', radius: 68, color: '#a97c4b' },
  { name: '火龙果', radius: 82, color: '#dc507d' },
  { name: '菠萝', radius: 97, color: '#edc65c' },
  { name: '西瓜', radius: 112, color: '#76b54b' },
].map((fruit, index) => ({ ...fruit, image: `assets/fruits/fruit-${String(index + 1).padStart(2, '0')}.png` }));

export const BOARD = { width: 420, height: 600, left: 18, right: 402, floor: 580, danger: 117, spawn: 56 };

export function randomFruit() {
  const value = Math.random();
  return value < .3 ? 0 : value < .56 ? 1 : value < .77 ? 2 : value < .92 ? 3 : 4;
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
