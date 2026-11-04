#Author: Kurian Benoy
FROM python:3.13.17-slim-trixie@sha256:57b29a7c050c4e679e4bea572e14b3965cf4b5839de2da49d55e49ffc4024f39

# set label for image
LABEL Name="formsflow"

WORKDIR /forms-flow-documents/app

# Apply security patches and install Chromium with its matching driver from Debian
# (amd64 and arm64), so both get Debian's security updates. git: requirements.txt installs
# formsflow_api_utils from a git URL.
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends chromium chromium-driver fonts-liberation fonts-dejavu-core git \
  && ln -fs /usr/bin/chromedriver /usr/local/bin/chromedriver \
  && rm -rf /var/lib/apt/lists/*

# set display port to avoid crash
ENV DISPLAY=:99

COPY requirements.txt .
ENV PATH=/venv/bin:$PATH

RUN : \
    && python3 -m venv /venv \
    && pip install --upgrade pip \
    && pip install -r requirements.txt 

ADD . /forms-flow-documents/app
RUN pip install -e .

EXPOSE 5006
RUN chmod u+x ./entrypoint
ENTRYPOINT ["/bin/sh", "entrypoint"]