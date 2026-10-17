// Compatibility mode is a reasoning backend for the application, not a second tool runner.
// Flags are invocation-local: never mutate the user's Codex configuration/auth.
export const disabledCompatibilityFeatures = Object.freeze([
  'shell_tool','unified_exec','shell_snapshot','apps','plugins','remote_plugin',
  'browser_use','browser_use_external','browser_use_full_cdp_access','computer_use',
  'in_app_browser','in_app_chat','in_app_local_automation','image_generation','view_image',
  'code_mode','multi_agent','multi_agent_v2','hooks','memories',
  'goals','workspace_dependencies','skill_search','skill_mcp_dependency_install',
  'request_permissions_tool','sleep_tool','tool_suggest',
]);

export function compatibilityToolArgs(){
  return ['--ignore-user-config', '--strict-config','--enable','code_mode_host',
    ...disabledCompatibilityFeatures.flatMap(name=>['--disable',name]),
    '-c','agents.enabled=false','-c','mcp_servers={}',
    '-c','web_search="live"','-c','approval_policy="on-request"','-c','project_doc_max_bytes=0',
    '-c','default_permissions="application_reasoning"',
    '-c','permissions.application_reasoning={filesystem={":minimal"="read",":workspace_roots"="read"},network={enabled=false}}'];
}

// createWorkspaceShell passes arguments through bash. Quote every argument,
// including TOML values, instead of relying on shell interpretation.
export const shellQuote = value => "'"+String(value).replaceAll("'", "'\\''")+"'";

export function forbiddenCompatibilityTools(names){return names.filter(name=>name!=='web_search');}
