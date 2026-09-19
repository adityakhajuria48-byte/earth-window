FROM python:3.12-slim
WORKDIR /app
COPY requirements-raster.txt .
RUN pip install --no-cache-dir -r requirements-raster.txt
COPY app.py crops.py previews.py ./
COPY dist ./dist
RUN useradd --uid 10001 --create-home earthwindow
USER earthwindow
ENV PORT=8000
EXPOSE 8000
CMD ["python", "app.py", "--host", "0.0.0.0"]
