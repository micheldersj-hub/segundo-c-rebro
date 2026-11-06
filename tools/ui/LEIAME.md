# Testes de interface do app (Playwright)
Precisam do repositório do app ao lado deste (`../segundo-cerebro-app`) ou `APP_DIR=/caminho`.
- `node telas.mjs 320,390 config,radar` — abre as telas nas larguras, falha se houver erro ou rolagem lateral; prints em `$SAIDA` (padrão /tmp).
  `ESCURO=1` para o tema escuro. Respostas do servidor vêm de `fx/<funcao>_<caminho>.json` (dados de teste).
- `node interacao_config.mjs` — clica na aba Configuração e confere as chamadas.
- `node teclado.mjs` — simula o teclado do iPhone e confere a barra de baixo.
- `node --test exportar.test.mjs` — serviços de exportação do app (`exportar.js`) com o jsPDF real de `vendor/`: telefone E.164, e-mail, CSV, PDF de 1/12/100/500 empresas conferido com `pdftotext`, falhas.
- `node interacao_envio.mjs` — exportação ponta a ponta na tela (PDF/CSV com folha nativa, e-mail, WhatsApp pelo celular e comercial, sem internet, toque duplo). `LARG=320 ESCURO=1`.
