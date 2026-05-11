// `envstore licenses` — prints third-party attribution shipped in the binary.
//
// BSD 3-Clause and similar licenses require us to reproduce the upstream
// copyright + conditions + disclaimer in the materials accompanying a binary
// distribution. The compiled CLI is one such distribution, so this command
// embeds the notice directly. Power-of-belt-and-braces: the same content lives
// in THIRD_PARTY_LICENSES.md at the repo root.

import type { Args } from '../lib/args';
import { c, heading } from '../lib/output';

const AGE_LICENSE = `Copyright 2023 The age Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of the age project nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

export async function licenses(_args: Args): Promise<void> {
  console.log(`${c.bold('envstore')} is distributed under AGPL v3.`);
  console.log('Source + LICENSE: https://github.com/michael-ketzer/envstore.xyz');
  console.log();
  console.log('It bundles the following third-party software:');
  console.log();

  heading('age-encryption (BSD 3-Clause)');
  console.log('Package: age-encryption (https://github.com/FiloSottile/typage)');
  console.log('Reference Go implementation: https://github.com/FiloSottile/age');
  console.log();
  console.log(
    c.gray(
      'envstore is not affiliated with, endorsed by, or sponsored by the age project or its authors.',
    ),
  );
  console.log();
  console.log(AGE_LICENSE);
  console.log();

  heading('Full third-party attribution');
  console.log(
    'For the complete list of dependencies and their licenses, see THIRD_PARTY_LICENSES.md:',
  );
  console.log('https://github.com/michael-ketzer/envstore.xyz/blob/main/THIRD_PARTY_LICENSES.md');
}
