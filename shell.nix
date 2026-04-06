{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.python312
    pkgs.nixd
    pkgs.git
  ];

  shellHook = ''
    set -e

    # venv
    if [ ! -d venv ]; then
      python3 -m venv venv
    fi
    . venv/bin/activate || true

    # deps — only reinstall when requirements.txt changes
    if [ -f requirements.txt ]; then
      REQ_HASH=$(python3 -c "import hashlib; print(hashlib.md5(open('requirements.txt','rb').read()).hexdigest())")
      HASH_FILE="venv/.requirements_hash"
      if [ ! -f "$HASH_FILE" ] || [ "$(cat $HASH_FILE)" != "$REQ_HASH" ]; then
        echo "requirements.txt changed — installing deps..."
        python -m pip install --upgrade pip setuptools wheel
        python -m pip install -r requirements.txt
        echo "$REQ_HASH" > "$HASH_FILE"
      fi
    fi

    # project scripts
    export PATH="$PWD/bin:$PATH"
  '';
}
