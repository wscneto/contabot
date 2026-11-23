import { normalizeVideoUri, prepareVideoUriCandidates } from '@/utils/video-uri';

describe('normalizeVideoUri', () => {
  test.each([
    ['/data/user/0/app/cache/video.mp4', 'file:///data/user/0/app/cache/video.mp4'],
    ['data/video.mp4', 'file:///data/video.mp4'],
    ['file:///data/video.mp4', 'file:///data/video.mp4'],
    ['file://data/video.mp4', 'file:///data/video.mp4'],
    ['  file:///data/video.mp4  ', 'file:///data/video.mp4'],
  ])('normaliza caminho local %p', (input, expected) => {
    expect(normalizeVideoUri(input)).toBe(expected);
  });

  test.each([
    'content://media/external/video/media/42',
    'http://exemplo.com/v.mp4',
    'https://exemplo.com/v.mp4',
  ])('mantém URIs remotas/content %p', (uri) => {
    expect(normalizeVideoUri(uri)).toBe(uri);
  });

  test('é idempotente', () => {
    const once = normalizeVideoUri('/tmp/a b.mp4');
    expect(normalizeVideoUri(once)).toBe(once);
  });
});

describe('prepareVideoUriCandidates', () => {
  test('caminho simples gera um único candidato', () => {
    expect(prepareVideoUriCandidates('/cache/video.mp4')).toEqual(['file:///cache/video.mp4']);
  });

  test('dupla codificação (%25) tenta primeiro a versão decodificada uma vez', () => {
    const uri = 'file:///data/user/0/host.exp.exponent/cache/%2540anon%252Fapp/video.mp4';
    expect(prepareVideoUriCandidates(uri)).toEqual([
      'file:///data/user/0/host.exp.exponent/cache/%40anon%2Fapp/video.mp4',
      uri,
      'file:///data/user/0/host.exp.exponent/cache/%40anon%2Fapp/video.mp4',
    ].filter((v, i, a) => a.indexOf(v) === i));
  });

  test('inclui a versão totalmente decodificada para caminhos com espaços codificados', () => {
    expect(prepareVideoUriCandidates('file:///cache/meu%20video.mp4')).toEqual([
      'file:///cache/meu%20video.mp4',
      'file:///cache/meu video.mp4',
    ]);
  });

  test('percent-encoding inválido não lança erro', () => {
    expect(() => prepareVideoUriCandidates('file:///cache/%E0%A4%A.mp4')).not.toThrow();
    expect(() => prepareVideoUriCandidates('file:///cache/%25E0%A4%A.mp4')).not.toThrow();
    expect(prepareVideoUriCandidates('file:///cache/%E0%A4%A.mp4')).toEqual([
      'file:///cache/%E0%A4%A.mp4',
    ]);
  });

  test('nunca devolve candidatos repetidos', () => {
    const list = prepareVideoUriCandidates('content://media/video%2520x');
    expect(new Set(list).size).toBe(list.length);
  });
});
