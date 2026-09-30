-- ================================================================
-- SEED F2 — Dados base: Perfis, Empresas, Setores
-- Execute no Neon SQL Editor
-- Idempotente: pode rodar múltiplas vezes sem duplicar
-- ================================================================

-- ── Perfis ──────────────────────────────────────────────────────────────────
INSERT INTO perfis (codigo, nome, permissoes, ativo, criado_em)
VALUES
  ('MASTER',           'Master',              ARRAY['*'],                                                                                                         true, NOW()),
  ('ADMINISTRADOR',    'Administrador',        ARRAY['usuarios:*','manifestacoes:*','rnc:*','relatorios:*','configuracoes:*'],                                     true, NOW()),
  ('SAC',              'SAC',                  ARRAY['manifestacoes:*','clientes:read','clientes:write','relatorios:read'],                                        true, NOW()),
  ('GESTOR_DE_SETOR',  'Gestor de Setor',      ARRAY['manifestacoes:read','manifestacoes:write','tratativas:*','rnc:*','relatorios:read'],                         true, NOW()),
  ('USUARIO_DE_SETOR', 'Usuário de Setor',     ARRAY['manifestacoes:read','tratativas:read','tratativas:write'],                                                   true, NOW()),
  ('REPRESENTANTE',    'Representante',        ARRAY['manifestacoes:read','clientes:read'],                                                                        true, NOW())
ON CONFLICT (codigo) DO UPDATE
  SET nome       = EXCLUDED.nome,
      permissoes = EXCLUDED.permissoes;

-- ── Empresas ────────────────────────────────────────────────────────────────
INSERT INTO empresas (codigo, nome, ativa, criada_em, atualizada_em)
VALUES
  ('CHIACCHIO', 'Grupo Chiacchio',  true, NOW(), NOW()),
  ('PLASCHIO',  'Plaschio',          true, NOW(), NOW()),
  ('TUBAHIA',   'Tubahia / CESBAP', true, NOW(), NOW())
ON CONFLICT (codigo) DO UPDATE
  SET nome         = EXCLUDED.nome,
      atualizada_em = NOW();

-- ── Setores (por empresa) ────────────────────────────────────────────────────
-- A query usa subselect para pegar o id da empresa pelo código (sem hardcode de id)

INSERT INTO setores (empresa_id, codigo, nome, descricao, ativo, criado_em)
SELECT e.id, s.codigo, s.nome, s.descricao, true, NOW()
FROM empresas e
CROSS JOIN (VALUES
  ('SAC',        'SAC',                      'Serviço de Atendimento ao Cliente'),
  ('QUALIDADE',  'Qualidade',                'Gestão da Qualidade e RNC'),
  ('COMERCIAL',  'Comercial',                'Setor Comercial'),
  ('PRODUCAO',   'Produção',                 'Setor de Produção'),
  ('LOGISTICA',  'Logística',                'Setor de Logística'),
  ('FINANCEIRO', 'Financeiro',               'Setor Financeiro'),
  ('TI',         'Tecnologia da Informação', 'TI e Sistemas'),
  ('DIRETORIA',  'Diretoria',                'Alta Direção')
) AS s(codigo, nome, descricao)
WHERE e.codigo IN ('CHIACCHIO','PLASCHIO','TUBAHIA')
ON CONFLICT (empresa_id, codigo) DO UPDATE
  SET nome      = EXCLUDED.nome,
      descricao = EXCLUDED.descricao;

-- ── Verificação ──────────────────────────────────────────────────────────────
SELECT 'perfis'   AS tabela, COUNT(*)::int AS total FROM perfis
UNION ALL
SELECT 'empresas' AS tabela, COUNT(*)::int AS total FROM empresas
UNION ALL
SELECT 'setores'  AS tabela, COUNT(*)::int AS total FROM setores;
