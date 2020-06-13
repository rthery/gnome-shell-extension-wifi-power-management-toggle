# Retrieve the UUID from ``metadata.json``
UUID = $(shell grep -E '^[ ]*"uuid":' ./metadata.json | sed 's@^[ ]*"uuid":[ ]*"\(.\+\)",[ ]*@\1@')
#$(info UUID is "$(UUID)")

# Infer the application name from the UUID
NAME = $(shell echo $(UUID) | sed 's/@.*//')
#$(info name is "$(NAME)")


.PHONY: all build clean run stop-run enable disable listen install uninstall restart-shell


all: build

build:
	gnome-extensions pack --force

clean:
	rm -rf "$(UUID)".shell-extension.zip

run: build install enable restart-shell listen

stop-run: disable clean

enable:
	gnome-extensions enable "$(UUID)"

disable:
	gnome-extensions disable "$(UUID)"

listen:
	trap "make stop-run; exit 0" INT; journalctl -o cat -n 0 -f "$$(which gnome-shell)"

install:
	gnome-extensions install --force "$(UUID)".shell-extension.zip

uninstall:
	gnome-extensions uninstall "$(UUID)" || true

restart-shell:
	if bash -c 'xprop -root &> /dev/null'; then # Check if we are using X \
		busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting Gnome Shell...")'; \
	else # Otherwise on Wayland for example we have no other choice than to log out and back in... \
		gnome-session-quit --logout; \
	fi
