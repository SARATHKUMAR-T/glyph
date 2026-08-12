if [ -n "${BASH_VERSION:-}" ]; then
  __nothing_terminal_file="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  __nothing_terminal_file="${(%):-%x}"
else
  return 0 2>/dev/null || exit 0
fi

__nothing_terminal_dir="$(CDPATH= cd -- "$(dirname -- "$__nothing_terminal_file")" && pwd -P)"

if [ -n "${BASH_VERSION:-}" ]; then
  . "$__nothing_terminal_dir/nothing-terminal.bash"
elif [ -n "${ZSH_VERSION:-}" ]; then
  . "$__nothing_terminal_dir/nothing-terminal.zsh"
fi

unset __nothing_terminal_file
unset __nothing_terminal_dir
