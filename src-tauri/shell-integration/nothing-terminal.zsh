if [ -n "${NOTHING_TERMINAL_ZSH_INTEGRATION:-}" ]; then
  return 0
fi

NOTHING_TERMINAL_ZSH_INTEGRATION=1

autoload -Uz add-zsh-hook

__nothing_terminal_osc133() {
  printf '\033]133;%s\a' "$1"
}

__nothing_terminal_precmd() {
  local exit_code=$?
  __nothing_terminal_osc133 "D;$exit_code"
  __nothing_terminal_osc133 "A"
  __nothing_terminal_osc133 "B"
  return "$exit_code"
}

__nothing_terminal_preexec() {
  __nothing_terminal_osc133 "C"
}

add-zsh-hook precmd __nothing_terminal_precmd
add-zsh-hook preexec __nothing_terminal_preexec
