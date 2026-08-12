if [ -n "${NOTHING_TERMINAL_BASH_INTEGRATION:-}" ]; then
  return 0
fi

NOTHING_TERMINAL_BASH_INTEGRATION=1

__nothing_terminal_osc133() {
  printf '\033]133;%s\a' "$1"
}

__nothing_terminal_prompt_command() {
  local exit_code=$?
  __nothing_terminal_osc133 "D;$exit_code"
  __nothing_terminal_osc133 "A"
  __nothing_terminal_osc133 "B"
  return "$exit_code"
}

__nothing_terminal_preexec() {
  __nothing_terminal_osc133 "C"
}

if declare -p preexec_functions >/dev/null 2>&1; then
  preexec_functions+=(__nothing_terminal_preexec)
fi

case ";${PROMPT_COMMAND:-};" in
  *";__nothing_terminal_prompt_command;"*) ;;
  *)
    if [ -n "${PROMPT_COMMAND:-}" ]; then
      PROMPT_COMMAND="__nothing_terminal_prompt_command; ${PROMPT_COMMAND}"
    else
      PROMPT_COMMAND="__nothing_terminal_prompt_command"
    fi
    ;;
esac
