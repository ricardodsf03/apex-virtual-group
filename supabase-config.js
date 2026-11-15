// Configuração pública do Supabase para o frontend.
//
// A "publishable key" foi desenhada para ser pública: quem protege os dados
// são as políticas RLS do banco de dados, não o segredo desta chave.
// NUNCA colocar neste arquivo chaves secretas do Supabase (as de "service
// role" ou as que começam por "sb" + "_secret"), a senha do banco de
// dados, tokens ou comandos de terminal. Só JavaScript.
(function () {
  const config = Object.freeze({
    url: "https://hnuatpqegkolgsniphbx.supabase.co",
    publishableKey: "sb_publishable_coipHfNMwViyrnzkNQpo6A_ZoEfjp_t"
  });

  function validateSupabaseConfig(candidate) {
    const url = String(candidate?.url ?? "");
    const key = String(candidate?.publishableKey ?? "");
    const urlOk = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url);
    const keyOk = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
    return {
      url_configurada: urlOk,
      chave_configurada: keyOk,
      ok: urlOk && keyOk
    };
  }

  window.APEX_SUPABASE_CONFIG = config;
  window.apexValidateSupabaseConfig = validateSupabaseConfig;
})();
