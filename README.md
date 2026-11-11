# PLATTO.A · Apresentações

Material comercial do **PLATTO.A**, o cardápio digital com pratos em 3D, para apresentar a restaurantes, hamburguerias e pizzarias.

## O que tem aqui

| Arquivo | O que é |
| --- | --- |
| `index.html` | Página inicial com links para as duas apresentações |
| `experiencia-3d.html` | Apresentação para rolar, com os pratos em 3D ao fundo (arquivo único, abre direto no navegador) |
| `slides/index.html` | Apresentação em 13 slides (setas do teclado, tela cheia) |
| `fonte-3d/` | Código da experiência 3D (Vite + three.js) |

## Como apresentar

Abra `index.html` no navegador (ou publique o repositório no GitHub Pages).

- **Experiência 3D:** role devagar; a barra à direita pula entre as seções. Funciona melhor no notebook.
- **Slides:** `→` / `←` ou espaço para navegar; o botão **Tela cheia** fica no canto inferior direito. O endereço `slides/index.html#5` abre direto no slide 5.

## Editar a experiência 3D

```bash
cd fonte-3d
npm install
npm run dev      # para ver as mudanças na hora
npm run build    # gera o arquivo único e atualiza ../experiencia-3d.html
```

O motor 3D (`src/engine.ts` e `src/types.ts`) é uma cópia do usado no app do PLATTO.A, e as receitas dos pratos estão em `src/scenes.json`.

## Conteúdo

- Planos: implantação a partir de R$ 600 (em até 3x no cartão), Cardápio 3D R$ 130/mês, Cardápio + Pedidos R$ 180/mês.
- Prazo para colocar no ar: de 3 a 15 dias úteis depois de receber o cardápio.
- O QR Code do cardápio de demonstração foi retirado até a autorização do restaurante.
- O painel de pedidos mostrado nas apresentações é um exemplo ilustrativo.

Contato: victor.anjos1011@gmail.com
